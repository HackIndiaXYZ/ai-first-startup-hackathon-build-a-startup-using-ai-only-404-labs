# Frame Autonomous AI Shopping Agent — Execution Flow

## 1. Lifecycle State Machine

```
   [USER INSTRUCTION]
           │
           ▼
    INITIALIZING
           │
           ▼
    PARSING_INTENT ──────── (Intent Parse Failure) ───────► FAILED
           │
           ▼
   SEARCHING_CATALOG ───── (No inventory in budget) ─────► FAILED
           │
           ▼
  COMPARING_PRODUCTS ──── (Preference mismatch) ────────► FAILED
           │
           ▼
   PRODUCT_SELECTED
           │
           ▼
     CARTING_ITEM
           │
           ▼
     CHECKING_OUT
           │
           ▼
 CANONICALIZING_CHECKOUT
           │
           ▼
   BINDING_VERIFICATION ── (Budget/Substitution Error) ──► TERMINATED_BY_SECURITY
           │
           ▼
CHECKING_FRAME_AUTHORITY ─ (Authority Inactive/Exceeded) ─► TERMINATED_BY_SECURITY
           │
           ▼
CREATING_PAYMENT_INTENT
           │
     ┌─────┴─────────────────────────┐
     │                               │
  [ALLOW]                  [REQUIRE_APPROVAL]               [DENY]
     │                               │                        │
     ▼                               ▼                        ▼
EXECUTING_PAYMENT       WAITING_FOR_HUMAN_APPROVAL   TERMINATED_BY_POLICY
     │                               │
     ▼                               │ (Human approves in Dashboard)
CONFIRMING_ORDER <───────────────────┘
     │
     ▼
 SUCCEEDED
```

---

## 2. Step-by-Step Flow Explanation

1. **User Request**: User provides natural language prompt e.g. *"Buy me a mechanical keyboard under ₹3,000"*.
2. **Intent Parsing & Freezing**: The agent extracts `product_type`, `max_amount_paise: 300000`, `currency: 'INR'`, and locks the object with `Object.freeze`.
3. **Catalog Discovery**: Searches merchant catalog. Emits `product.found` events.
4. **Transparent Ranking**: Scores candidates based on budget, relevance, brand preferences, and stock status.
5. **Cart & Checkout**: Generates merchant order session and extracts subtotal, shipping, tax, and total.
6. **Intent Binding Check**:
   - `total_paise <= userIntent.max_amount_paise`
   - `category is allowed`
   - `product matches user query (anti-substitution)`
7. **Frame Payment Authority Inspection**: Checks active status, max transaction limit, and daily budget.
8. **Payment Intent Creation**: Submits intent to Frame Policy Firewall with deterministic idempotency key.
9. **Decision Execution**:
   - `ALLOW`: Completes payment and fulfills order.
   - `REQUIRE_APPROVAL`: Escalates to human principal; pauses execution safely.
   - `DENY`: Enforces `DO_NOT_RETRY` and explains policy violation.
   - `UNKNOWN`: Polls status; never assumes success without confirmation.
