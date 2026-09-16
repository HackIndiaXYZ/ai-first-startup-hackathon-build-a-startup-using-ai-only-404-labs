#!/usr/bin/env python3
"""
Python SDK Integration Test
Verifies: Python SDK -> Frame API -> Payment Intent -> Policy -> Provider -> Status
"""
import sys
import os
import time
import json
import urllib.request
import urllib.error

# Add python sdk to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../sdk/python")))

from frame_pay.client import FrameClient, FramePaymentError

BASE_URL = "http://localhost:3001"

def assert_true(cond, msg):
    if not cond:
        print(f"❌ ASSERTION FAILED: {msg}")
        sys.exit(1)
    print(f"  ✓ {msg}")

def http_post(path, data, token=None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main():
    print("================================================================")
    print("🐍 FRAME PYTHON SDK INTEGRATION TEST")
    print("================================================================\n")

    # 1. Health check
    req = urllib.request.Request(f"{BASE_URL}/health")
    with urllib.request.urlopen(req) as resp:
        assert_true(resp.status == 200, "Frame API health check passed")

    test_id = str(int(time.time()))

    # 2. Provision Admin User & Org via API
    print("--- 1. Provision User & Org via Frame API ---")
    reg_resp = http_post("/v1/auth/register", {
        "email": f"python_sdk_{test_id}@test.corp",
        "password": "Password123!",
        "name": "Python SDK Tester",
        "organization_name": f"Python SDK Corp {test_id}"
    })
    token = reg_resp["data"]["token"]
    org_id = reg_resp["data"]["organization"]["id"]
    assert_true(bool(token), "Admin token acquired")

    # 3. Create Agent
    print("\n--- 2. Create Agent & Credentials ---")
    agent_resp = http_post("/v1/agents", {
        "name": f"Python Procurement Bot {test_id}",
        "description": "Agent running Python SDK",
        "purpose": "Automated procurement"
    }, token=token)
    agent_id = agent_resp["data"]["id"]
    assert_true(bool(agent_id), f"Agent created with ID: {agent_id}")

    # Generate API key
    cred_resp = http_post(f"/v1/agents/{agent_id}/credentials", {}, token=token)
    agent_api_key = cred_resp["data"]["api_key"]
    assert_true(agent_api_key.startswith("frm_"), "Agent API key generated")

    # 4. Create Policy & Grant Payment Authority
    print("\n--- 3. Create Policy & Grant Payment Authority ---")
    http_post("/v1/policies", {
        "agent_id": agent_id,
        "name": f"Policy for {agent_id}",
        "transaction_limit_paise": 500000,
        "daily_limit_paise": 2000000,
        "monthly_limit_paise": 5000000,
        "approval_threshold_paise": 300000
    }, token=token)

    auth_resp = http_post("/v1/payment-authorities", {
        "agent_id": agent_id,
        "max_transaction_amount_paise": 500000, # ₹5,000
        "daily_limit_paise": 2000000,           # ₹20,000
        "monthly_limit_paise": 5000000,         # ₹50,000
        "allowed_categories": ["electronics", "office_supplies"],
        "allowed_merchants": ["tech-gear", "demo-merchant"],
        "purpose": "Python SDK hardware orders",
        "valid_until": "2030-12-31T23:59:59Z"
    }, token=token)
    auth_id = auth_resp["data"]["id"]
    assert_true(bool(auth_id), f"Authority granted: {auth_id}")

    # 5. Initialize Python FrameClient
    print("\n--- 4. Initialize Python FrameClient ---")
    client = FrameClient(api_key=agent_api_key, base_url=BASE_URL)
    assert_true(isinstance(client, FrameClient), "FrameClient instantiated successfully")

    # 6. Inspect Authorities via SDK
    print("\n--- 5. Inspect Authorities via Python SDK ---")
    authorities = client.list_authorities()
    auth_list = authorities.get("data", [])
    assert_true(len(auth_list) >= 1, "Agent authorities listed via SDK")
    target_auth = next((a for a in auth_list if a["id"] == auth_id), None)
    assert_true(target_auth is not None, f"Found target authority {auth_id} in agent's scoped authorities")

    auth_detail = client.get_authority(auth_id)
    assert_true(auth_detail.get("data", {}).get("status") == "ACTIVE", "Authority is confirmed ACTIVE")

    # 7. Execute Valid Payment (₹2,499)
    print("\n--- 6. Execute Payment (₹2,499) via Python SDK ---")
    decision = client.pay(
        amount=2499.0,
        merchant="tech-gear",
        purpose="Mechanical keyboard under ₹3,000",
        category="electronics",
        merchant_reference=f"ORD_PY_{test_id}"
    )
    assert_true(bool(decision.id), f"Payment intent created: {decision.id}")
    assert_true(int(decision.amount_paise) == 249900, "Amount converted to paise (249900)")
    assert_true(decision.merchant == "tech-gear", "Merchant matches intent")
    assert_true(decision.status in ["SUCCEEDED", "AUTHORIZED", "EXECUTING"], f"Payment executed successfully: {decision.status}")

    # 8. Check Intent Status
    print("\n--- 7. Poll Payment Intent Status via Python SDK ---")
    fetched = client.get_intent(decision.id)
    assert_true(fetched.id == decision.id, "Fetched intent matches ID")
    assert_true(fetched.status in ["SUCCEEDED", "AUTHORIZED", "EXECUTING"], f"Current status: {fetched.status}")

    # 9. Guardrails: Attempt Excessive Payment (₹12,000 > ₹5,000 limit)
    print("\n--- 8. Guardrails: Exceeding Transaction Limit ---")
    excessive = client.pay(
        amount=12000.0,
        merchant="tech-gear",
        purpose="High-end GPU purchase",
        category="electronics"
    )
    assert_true(excessive.status in ["DENIED", "PENDING_APPROVAL"], f"High amount policy enforced: {excessive.status}")

    # 10. Security: Invalid API Key Rejection
    print("\n--- 9. Security: Verify Invalid Credential Rejection ---")
    invalid_client = FrameClient(api_key="frm_test_invalid_python_key", base_url=BASE_URL)
    threw_error = False
    try:
        invalid_client.list_authorities()
    except FramePaymentError as e:
        threw_error = True
        assert_true(e.status_code == 401, f"Received expected HTTP 401: {e.code}")

    assert_true(threw_error, "Invalid credentials correctly rejected with FramePaymentError")

    print("\n================================================================")
    print("✅ FRAME PYTHON SDK INTEGRATION TEST PASSED")
    print("================================================================\n")

if __name__ == "__main__":
    main()
