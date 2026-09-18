import assert from 'assert';
import { canonicalizeCheckout } from '../../src/checkout/checkout-extractor';
import { MerchantCheckoutSession } from '../../src/merchants/merchant-adapter';

console.log('🧪 RUNNING TEST: Checkout Canonicalizer Unit Test\n');

const session: MerchantCheckoutSession = {
  orderId: 'ORD_999',
  merchantId: 'store_01',
  merchantName: 'Alpha Electronics',
  items: [
    {
      productId: 'p_kbd',
      productName: 'Mechanical Keyboard TKL',
      quantity: 1,
      priceRupees: 2499,
      pricePaise: 249900,
      category: 'electronics',
    },
  ],
  subtotalRupees: 2499,
  subtotalPaise: 249900,
  shippingRupees: 100,
  shippingPaise: 10000,
  taxRupees: 50,
  taxPaise: 5000,
  totalRupees: 2649,
  totalPaise: 264900,
  currency: 'INR',
  status: 'AWAITING_PAYMENT',
};

const canonical = canonicalizeCheckout(session);

assert.strictEqual(canonical.merchant_name, 'Alpha Electronics');
assert.strictEqual(canonical.order_id, 'ORD_999');
assert.strictEqual(canonical.subtotal_paise, 249900);
assert.strictEqual(canonical.shipping_paise, 10000);
assert.strictEqual(canonical.tax_paise, 5000);
assert.strictEqual(canonical.total_paise, 264900);
assert.strictEqual(canonical.total_rupees, 2649);
console.log('  ✓ Test 1 Passed: Canonical checkout includes subtotal + shipping + tax correctly');

console.log('\n🎉 Checkout Canonicalizer Unit Test PASSED\n');
