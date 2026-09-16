import json
import urllib.request
import urllib.error
import time
import uuid
from typing import Optional, Dict, Any
from dataclasses import dataclass


class FramePaymentError(Exception):
    def __init__(self, message: str, code: str = "API_ERROR", status_code: Optional[int] = None, details: Any = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details


@dataclass
class PaymentDecision:
    id: str
    status: str
    amount_paise: int
    currency: str
    merchant: str
    purpose: str
    decision: Optional[str] = None
    denial_reason: Optional[str] = None
    requires_approval: bool = False
    approval_task_id: Optional[str] = None
    transaction_id: Optional[str] = None
    created_at: Optional[str] = None

    @property
    def amount_rupees(self) -> float:
        return self.amount_paise / 100.0


class FrameClient:
    """
    Client for interacting with Frame Autonomous Payments API.
    """

    def __init__(self, api_key: str, base_url: str = "http://localhost:3001", timeout: int = 30):
        if not api_key:
            raise ValueError("api_key must be provided (e.g. frm_live_... or frm_test_...)")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def pay(
        self,
        amount: float,
        merchant: str,
        purpose: str,
        currency: str = "INR",
        category: Optional[str] = None,
        merchant_reference: Optional[str] = None,
        task_reference: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        expires_in_seconds: int = 3600,
    ) -> PaymentDecision:
        """
        Request or execute a payment on behalf of the agent.
        """
        amount_paise = int(round(amount * 100))
        if not idempotency_key:
            idempotency_key = f"py_agent_{int(time.time())}_{uuid.uuid4().hex[:8]}"

        payload = {
            "amount_paise": amount_paise,
            "currency": currency,
            "merchant": merchant,
            "purpose": purpose,
            "idempotency_key": idempotency_key,
            "expires_in_seconds": expires_in_seconds,
        }
        if category:
            payload["category"] = category
        if merchant_reference:
            payload["merchant_reference"] = merchant_reference
        if task_reference:
            payload["task_reference"] = task_reference
        if metadata:
            payload["metadata"] = metadata

        res = self._request("POST", "/v1/payment-intents", payload)
        d = res.get("data", {})
        return PaymentDecision(
            id=d.get("id", ""),
            status=d.get("status", ""),
            amount_paise=d.get("amount_paise", amount_paise),
            currency=d.get("currency", currency),
            merchant=d.get("merchant", merchant),
            purpose=d.get("purpose", purpose),
            decision=d.get("decision"),
            denial_reason=d.get("denial_reason"),
            requires_approval=(d.get("status") == "PENDING_APPROVAL"),
            approval_task_id=d.get("approval_task_id"),
            transaction_id=d.get("transaction_id"),
            created_at=d.get("created_at"),
        )

    def get_intent(self, intent_id: str) -> PaymentDecision:
        """
        Fetch status and details of a payment intent by ID.
        """
        res = self._request("GET", f"/v1/payment-intents/{intent_id}")
        d = res.get("data", {})
        return PaymentDecision(
            id=d.get("id", ""),
            status=d.get("status", ""),
            amount_paise=d.get("amount_paise", 0),
            currency=d.get("currency", "INR"),
            merchant=d.get("merchant", ""),
            purpose=d.get("purpose", ""),
            decision=d.get("decision"),
            denial_reason=d.get("denial_reason"),
            requires_approval=(d.get("status") == "PENDING_APPROVAL"),
            approval_task_id=d.get("approval_task_id"),
            transaction_id=d.get("transaction_id"),
            created_at=d.get("created_at"),
        )

    def execute_intent(self, intent_id: str, provider: Optional[str] = None) -> Dict[str, Any]:
        """
        Explicitly trigger payment execution for an authorized or approved intent.
        """
        payload = {}
        if provider:
            payload["provider"] = provider
        return self._request("POST", f"/v1/payment-intents/{intent_id}/execute", payload)

    def get_payment(self, payment_id: str) -> Dict[str, Any]:
        """
        Fetch payment record by payment ID.
        """
        return self._request("GET", f"/v1/payments/{payment_id}")

    def list_payments(self, limit: int = 50, offset: int = 0, status: Optional[str] = None) -> Dict[str, Any]:
        """
        List payment records.
        """
        query_parts = [f"limit={limit}", f"offset={offset}"]
        if status:
            query_parts.append(f"status={status}")
        qs = "&".join(query_parts)
        return self._request("GET", f"/v1/payments?{qs}")

    def list_authorities(self, status: Optional[str] = None) -> Dict[str, Any]:
        """
        List payment authorities available to this agent or tenant.
        """
        qs = f"?status={status}" if status else ""
        return self._request("GET", f"/v1/payment-authorities{qs}")

    def get_authority(self, authority_id: str) -> Dict[str, Any]:
        """
        Fetch details of a specific payment authority.
        """
        return self._request("GET", f"/v1/payment-authorities/{authority_id}")

    def as_langchain_tool(self):
        """
        Return a LangChain StructuredTool instance for agent workflows.
        """
        try:
            from langchain_core.tools import StructuredTool
            from pydantic import BaseModel, Field

            class PaymentInput(BaseModel):
                amount: float = Field(description="Payment amount in Rupees (e.g. 500.00)")
                merchant: str = Field(description="Target vendor or recipient")
                purpose: str = Field(description="Business reasoning for payment")
                category: Optional[str] = Field(default=None, description="Spending category e.g. cloud, saas")

            def tool_fn(amount: float, merchant: str, purpose: str, category: Optional[str] = None) -> str:
                decision = self.pay(amount=amount, merchant=merchant, purpose=purpose, category=category)
                return f"Payment status: {decision.status}. ID: {decision.id}. Decision: {decision.decision}"

            return StructuredTool.from_function(
                func=tool_fn,
                name="frame_execute_payment",
                description="Make real payments with spending limits and policy guardrails",
                args_schema=PaymentInput,
            )
        except ImportError:
            raise ImportError("langchain_core is required to use as_langchain_tool(). Install via 'pip install langchain-core'.")

    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        data_bytes = json.dumps(body).encode("utf-8") if body is not None else None

        req = urllib.request.Request(
            url,
            data=data_bytes,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "X-API-Key": self.api_key,
                "User-Agent": "frame-pay-py/1.0.0",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                content = resp.read().decode("utf-8")
                return json.loads(content) if content else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                parsed = json.loads(err_body)
                err_code = parsed.get("error", {}).get("code", "HTTP_ERROR")
                err_msg = parsed.get("error", {}).get("message", f"HTTP {e.code}: {e.reason}")
            except Exception:
                err_code = "HTTP_ERROR"
                err_msg = f"HTTP {e.code}: {err_body or e.reason}"
            raise FramePaymentError(err_msg, code=err_code, status_code=e.code)
        except Exception as e:
            raise FramePaymentError(str(e), code="NETWORK_ERROR")
