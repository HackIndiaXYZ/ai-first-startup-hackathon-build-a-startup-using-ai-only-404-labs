import { ShoppingAgent } from '../core/agent';
import { defaultExecutionStore } from '../state/execution-store';

async function main() {
  const args = process.argv.slice(2);
  const instruction = args[0] || 'Buy me a mechanical keyboard under ₹3,000';
  const apiKey = process.env.FRAME_AGENT_API_KEY;

  console.log('\n============================================================');
  console.log('🤖 FRAME AUTONOMOUS AI SHOPPING AGENT');
  console.log('============================================================');
  console.log(`🎯 Instruction: "${instruction}"`);
  if (apiKey) {
    console.log(`🔑 Frame Agent Key: ${apiKey.slice(0, 12)}...`);
  } else {
    console.log(`⚠️ No FRAME_AGENT_API_KEY supplied — will run demo merchant authorization flow`);
  }
  console.log('------------------------------------------------------------\n');

  const agent = new ShoppingAgent();
  if (apiKey) {
    agent.setFrameApiKey(apiKey);
  }

  // Create listener for real-time streaming
  const store = defaultExecutionStore;
  const startTime = Date.now();

  try {
    const result = await agent.execute(instruction);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n============================================================');
    console.log(`🏁 EXECUTION SUMMARY (took ${elapsed}s)`);
    console.log('============================================================');
    console.log(`Status:               ${result.status}`);
    console.log(`Product Selected:     ${result.selectedProduct ? `${result.selectedProduct.name} (₹${result.selectedProduct.price_rupees})` : 'None'}`);
    if (result.selectionReason) {
      console.log(`Selection Reason:     ${result.selectionReason}`);
    }
    if (result.canonicalCheckout) {
      console.log(`Canonical Checkout:   Total ₹${result.canonicalCheckout.total_rupees} (Subtotal: ₹${result.canonicalCheckout.subtotal_paise / 100})`);
    }
    if (result.framePaymentIntent) {
      console.log(`Frame Decision:       ${result.framePaymentIntent.decision} (Intent ID: ${result.framePaymentIntent.payment_intent_id})`);
    }
    if (result.orderConfirmation) {
      console.log(`Order Status:         ${result.orderConfirmation.status} (Order: ${result.orderConfirmation.orderId})`);
    }
    if (result.humanInterventionRequired) {
      console.log(`⏸️ Human Approval:     ${result.humanInterventionRequired.reason}`);
    }
    if (result.error) {
      console.log(`❌ Error:              [${result.error.code}] ${result.error.message}`);
    }
    console.log('============================================================\n');

    process.exit(result.status === 'SUCCEEDED' || result.status === 'WAITING_FOR_HUMAN_APPROVAL' ? 0 : 1);
  } catch (err: any) {
    console.error(`\n💥 Fatal execution crash:`, err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
