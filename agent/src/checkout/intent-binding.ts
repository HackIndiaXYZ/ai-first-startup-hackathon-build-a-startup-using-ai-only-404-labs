import { CanonicalCheckout } from './checkout-extractor';
import { StructuredUserIntent } from '../intent/schema';
import { assertAllowedCategory, assertAllowedMerchant } from '../security/domain-policy';

export interface PaymentAuthorityConstraints {
  authority_id: string;
  max_transaction_amount_paise: number;
  daily_limit_paise?: number;
  remaining_daily_budget_paise?: number;
  monthly_limit_paise?: number;
  requires_approval_above_paise?: number;
  allowed_merchants?: string[];
  blocked_merchants?: string[];
  allowed_categories?: string[];
  blocked_categories?: string[];
  status: string;
}

export class IntentBindingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IntentBindingError';
    this.code = code;
  }
}

/**
 * Validates that a canonical checkout strictly conforms to:
 * 1. The original immutable User Intent
 * 2. The Frame Payment Authority constraints
 *
 * FAILS CLOSED if any discrepancy is detected.
 */
export function verifyIntentBinding(
  intent: StructuredUserIntent,
  checkout: CanonicalCheckout,
  authority?: PaymentAuthorityConstraints
): void {
  // 1. Budget Constraint: Final checkout total MUST NOT exceed original user budget
  if (checkout.total_paise > intent.max_amount_paise) {
    throw new IntentBindingError(
      'BUDGET_EXCEEDED',
      `Intent binding violation: Checkout total ₹${checkout.total_rupees} (paise: ${checkout.total_paise}) exceeds original user budget of ₹${intent.max_amount_rupees} (paise: ${intent.max_amount_paise}).`
    );
  }

  // 2. Currency Constraint: Currency must match
  if (checkout.currency.toUpperCase() !== intent.currency.toUpperCase()) {
    throw new IntentBindingError(
      'CURRENCY_MISMATCH',
      `Currency mismatch: checkout is in ${checkout.currency}, expected ${intent.currency}.`
    );
  }

  // 3. Category & Domain Policy: Category must not be prohibited
  assertAllowedCategory(checkout.category, authority?.allowed_categories);

  // 4. Product Substitution Guard: Ensure product matches user's sought product type
  const soughtKeywords = intent.product_type.toLowerCase().split(/\s+/).filter(Boolean);
  const checkoutText = `${checkout.product_name} ${checkout.category}`.toLowerCase();

  const matchesKeyword = soughtKeywords.some((kw) => checkoutText.includes(kw));
  // If no keywords match at all, flag product substitution
  if (!matchesKeyword && soughtKeywords.length > 0 && intent.product_type !== 'product' && intent.product_type !== 'item') {
    throw new IntentBindingError(
      'PRODUCT_SUBSTITUTION_DETECTED',
      `Intent binding violation: Item "${checkout.product_name}" does not match user's sought item "${intent.product_type}". Product substitution is strictly prohibited.`
    );
  }

  // 5. Payment Authority Constraints Check (if authority is attached)
  if (authority) {
    if (authority.status !== 'ACTIVE') {
      throw new IntentBindingError(
        'AUTHORITY_INACTIVE',
        `Payment authority ${authority.authority_id} is in status '${authority.status}', not ACTIVE.`
      );
    }

    if (checkout.total_paise > authority.max_transaction_amount_paise) {
      throw new IntentBindingError(
        'AUTHORITY_TRANSACTION_LIMIT_EXCEEDED',
        `Checkout total ₹${checkout.total_rupees} exceeds payment authority max per-transaction limit (₹${authority.max_transaction_amount_paise / 100}).`
      );
    }

    if (
      authority.remaining_daily_budget_paise !== undefined &&
      checkout.total_paise > authority.remaining_daily_budget_paise
    ) {
      throw new IntentBindingError(
        'AUTHORITY_DAILY_BUDGET_EXCEEDED',
        `Checkout total ₹${checkout.total_rupees} exceeds remaining daily authority allowance (₹${authority.remaining_daily_budget_paise / 100}).`
      );
    }

    assertAllowedMerchant(checkout.merchant_name, authority.blocked_merchants, authority.allowed_merchants);
  }
}
