import assert from 'assert';
import { parseIntentDeterministic } from '../../src/intent/parser';

console.log('🧪 RUNNING TEST: Intent Parser Unit Test\n');

// Test 1: Standard rupees syntax
const intent1 = parseIntentDeterministic('Buy me a mechanical keyboard under ₹3,000');
assert.strictEqual(intent1.task, 'purchase');
assert.strictEqual(intent1.product_type.toLowerCase(), 'mechanical keyboard');
assert.strictEqual(intent1.max_amount_rupees, 3000);
assert.strictEqual(intent1.max_amount_paise, 300000);
assert.strictEqual(intent1.currency, 'INR');
console.log('  ✓ Test 1 Passed: Parses "under ₹3,000" correctly');

// Test 2: Comma separation & "rs." syntax
const intent2 = parseIntentDeterministic('Order ergonomic office chair below Rs. 18,500');
assert.strictEqual(intent2.product_type.toLowerCase(), 'ergonomic office chair');
assert.strictEqual(intent2.max_amount_rupees, 18500);
assert.strictEqual(intent2.max_amount_paise, 1850000);
console.log('  ✓ Test 2 Passed: Parses "below Rs. 18,500" correctly');

// Test 3: Budget keyword syntax
const intent3 = parseIntentDeterministic('Find wireless mouse max budget 1500');
assert.strictEqual(intent3.product_type.toLowerCase(), 'wireless mouse');
assert.strictEqual(intent3.max_amount_rupees, 1500);
assert.strictEqual(intent3.max_amount_paise, 150000);
console.log('  ✓ Test 3 Passed: Parses "max budget 1500" correctly');

// Test 4: Immutability check (Object.freeze)
assert.throws(() => {
  // @ts-expect-error test runtime freeze
  intent1.max_amount_rupees = 999999;
}, /Cannot assign to read only property|read only/i);
console.log('  ✓ Test 4 Passed: Intent object is frozen and locked against mutation');

console.log('\n🎉 Intent Parser Unit Test PASSED\n');
