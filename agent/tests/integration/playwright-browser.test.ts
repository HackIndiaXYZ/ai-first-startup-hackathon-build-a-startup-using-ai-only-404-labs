import assert from 'assert';
import { DemoMerchantStore } from '../../../agentpay/backend/src/demo-merchant/server';
import { BrowserMerchantAdapter } from '../../src/merchants/browser-merchant-adapter';

async function runPlaywrightBrowserTest() {
  console.log('\n============================================================');
  console.log('🌐 RUNNING REAL PLAYWRIGHT BROWSER AUTOMATION INTEGRATION TEST');
  console.log('============================================================\n');

  // 1. Start Demo Merchant Store on port 3002
  const store = new DemoMerchantStore();
  const port = await store.start(3002);
  console.log(`  ✓ Storefront running at http://localhost:${port}/store`);

  // 2. Initialize BrowserMerchantAdapter with Playwright and Google Chrome
  const browserAdapter = new BrowserMerchantAdapter({
    baseUrl: `http://localhost:${port}`,
    headless: true,
  });

  try {
    // 3. Search Products via real Browser DOM
    console.log('\n--- 1. Testing Storefront Navigation & Search via Browser DOM ---');
    const products = await browserAdapter.searchProducts('keyboard', 3000);
    console.log(`  ✓ Extracted ${products.length} product(s) from live browser DOM`);
    assert(products.length >= 1, 'Should find at least 1 keyboard in DOM');
    const keyboard = products[0];
    assert.strictEqual(keyboard.id, 'prod_kbd_01');
    assert.strictEqual(keyboard.price_rupees, 2499);
    console.log(`  ✓ Successfully read: "${keyboard.name}" (₹${keyboard.price_rupees})`);

    // 4. View Product, Select Variant & Add to Cart via Browser DOM
    console.log('\n--- 2. Testing Variant Picker & Add-to-Cart via Browser DOM ---');
    const cart = await browserAdapter.addToCart('prod_kbd_01', 1, 'sw_red');
    console.log(`  ✓ Browser interacted with variant selector & clicked Add-to-Cart`);
    assert.strictEqual(cart.itemCount, 1);

    // 5. Proceed to Checkout & Extract Semantic Checkout DOM Attributes
    console.log('\n--- 3. Testing Semantic Checkout Extraction from DOM Data Attributes ---');
    const checkout = await browserAdapter.proceedToCheckout(cart);
    console.log(`  ✓ Extracted Checkout Session from DOM:`);
    console.log(`    - Order ID: ${checkout.orderId}`);
    console.log(`    - Subtotal: ₹${checkout.subtotalRupees}`);
    console.log(`    - Total: ₹${checkout.totalRupees}`);
    console.log(`    - Currency: ${checkout.currency}`);
    console.log(`    - Merchant: ${checkout.merchantName} (${checkout.merchantId})`);

    assert(checkout.orderId.startsWith('ORDER_'), 'Order ID should be generated from merchant checkout');
    assert.strictEqual(checkout.totalRupees, 2499);
    assert.strictEqual(checkout.currency, 'INR');
    assert.strictEqual(checkout.items[0].productId, 'prod_kbd_01');

    console.log('\n============================================================');
    console.log('🎉 REAL PLAYWRIGHT BROWSER AUTOMATION TEST PASSED 100%');
    console.log('============================================================\n');
  } finally {
    await browserAdapter.close();
    await store.stop();
  }
}

runPlaywrightBrowserTest().catch((err) => {
  console.error('❌ Playwright Browser Integration Test Failed:', err);
  process.exit(1);
});
