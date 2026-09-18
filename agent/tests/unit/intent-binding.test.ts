import assert from 'assert';
import { parseIntentDeterministic } from '../../src/intent/parser';
import { verifyIntentBinding, IntentBindingError } from '../../src/checkout/intent-binding';
import { CanonicalCheckout } from '../../src/checkout/checkout-extractor';

console.log('🧪 RUNNING TEST: Intent Binding Unit Test\n');

const intent = parseIntentDeterministic('Buy me a mechanical keyboard under ₹3,000');

const validCheckout: CanonicalCheckout = {
  merchant_id: 'tech_store',
  merchant_name: 'TechSupply Store',
  order_id: 'ord_123',
  product_id: 'prod_kbd_01',
  product_name: 'Mechanical Keyboard RGB',
  category: 'electronics',
  quantity: 1,
  subtotal_paise: 249900,
  shipping_paise: 5000,
  tax_paise: 0,
  discount_paise: 0,
  total_paise: 254900,
  total_rupees: 2549,
  currency: 'INR',
  purpose: 'mechanical keyboard',
  extracted_at: new Date().toISOString(),
};

// 1. Valid checkout within budget passes
assert.doesNotThrow(() => {
  verifyIntentBinding(intent, validCheckout);
});
console.log('  ✓ Test 1 Passed: Valid checkout within budget passes');

// 2. Budget exceeded fails
const expensiveCheckout: CanonicalCheckout = {
  ...validCheckout,
  total_paise: 350000,
  total_rupees: 3500,
};
assert.throws(() => {
  verifyIntentBinding(intent, expensiveCheckout);
}, (err: any) => err instanceof IntentBindingError && err.code === 'BUDGET_EXCEEDED');
console.log('  ✓ Test 2 Passed: Checkout exceeding user budget throws BUDGET_EXCEEDED');

// 3. Product substitution fails
const substitutedCheckout: CanonicalCheckout = {
  ...validCheckout,
  product_name: 'Ergonomic Gaming Chair',
  category: 'furniture',
};
assert.throws(() => {
  verifyIntentBinding(intent, substitutedCheckout);
}, (err: any) => err instanceof IntentBindingError && err.code === 'PRODUCT_SUBSTITUTION_DETECTED');
console.log('  ✓ Test 3 Passed: Product substitution throws PRODUCT_SUBSTITUTION_DETECTED');

// 4. Currency mismatch fails
const currencyMismatchCheckout: CanonicalCheckout = {
  ...validCheckout,
  currency: 'USD',
};
assert.throws(() => {
  verifyIntentBinding(intent, currencyMismatchCheckout);
}, (err: any) => err instanceof IntentBindingError && err.code === 'CURRENCY_MISMATCH');
console.log('  ✓ Test 4 Passed: Currency mismatch throws CURRENCY_MISMATCH');

console.log('\n🎉 Intent Binding Unit Test PASSED\n');
