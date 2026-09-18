import assert from 'assert';
import { parseIntentDeterministic } from '../../src/intent/parser';
import { rankProducts, selectBestProduct } from '../../src/shopping/ranking';
import { ProductCandidate } from '../../src/shopping/product';

console.log('🧪 RUNNING TEST: Product Ranking Unit Test\n');

const intent = parseIntentDeterministic('Buy me a mechanical keyboard under ₹3,000');

const candidates: ProductCandidate[] = [
  {
    id: 'p1',
    name: 'Standard Membrane Keyboard',
    description: 'Quiet office membrane keyboard',
    price_rupees: 999,
    price_paise: 99900,
    currency: 'INR',
    category: 'peripherals',
    in_stock: true,
    merchant_id: 'm1',
    merchant_name: 'TechStore',
  },
  {
    id: 'p2',
    name: 'Redragon Mechanical Keyboard RGB',
    description: 'Hot-swappable tactile mechanical keyboard',
    price_rupees: 2499,
    price_paise: 249900,
    currency: 'INR',
    category: 'peripherals',
    in_stock: true,
    merchant_id: 'm1',
    merchant_name: 'TechStore',
  },
  {
    id: 'p3',
    name: 'Razer Pro Mechanical Keyboard Elite',
    description: 'High-end mechanical gaming keyboard',
    price_rupees: 6999,
    price_paise: 699900,
    currency: 'INR',
    category: 'peripherals',
    in_stock: true,
    merchant_id: 'm1',
    merchant_name: 'TechStore',
  },
];

const ranked = rankProducts(candidates, intent);
assert.strictEqual(ranked.length, 3);
assert.strictEqual(ranked[0].product.id, 'p2', 'Best match should be the mechanical keyboard within budget');
console.log('  ✓ Test 1 Passed: Redragon mechanical keyboard ranked #1 within budget');

const selection = selectBestProduct(candidates, intent);
assert(selection !== null);
assert.strictEqual(selection.selected.id, 'p2');
assert(selection.reason.includes('Within user budget'));
console.log(`  ✓ Test 2 Passed: Selected product with transparent reason: "${selection.reason}"`);

console.log('\n🎉 Product Ranking Unit Test PASSED\n');
