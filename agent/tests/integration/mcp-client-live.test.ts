import assert from 'assert';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

console.log('🧪 RUNNING INTEGRATION TEST: Frame MCP Client over Stdio\n');

async function runMcpTest() {
  const backendRoot = path.resolve(__dirname, '../../../agentpay/backend');
  const mcpEntry = path.join(backendRoot, 'src/mcp/index.ts');

  console.log(`Connecting to Frame MCP Server at: ${mcpEntry}`);

  const transport = new StdioClientTransport({
    command: 'npm',
    args: ['--prefix', backendRoot, 'run', 'mcp'],
    env: {
      ...process.env,
      FRAME_API_URL: process.env.FRAME_API_URL || 'https://frame-backend-868z.onrender.com/v1',
      FRAME_AGENT_API_KEY: process.env.FRAME_AGENT_API_KEY || 'frm_test_simulated_key',
    },
  });

  const client = new Client(
    { name: 'shopping-agent-integration-test', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('  ✓ Stdio transport established with Frame MCP server');

  // List tools
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((t) => t.name);
  console.log(`  ✓ Discovered ${toolNames.length} MCP tools: ${toolNames.join(', ')}`);

  assert(toolNames.includes('frame_create_payment_intent'), 'Missing frame_create_payment_intent');
  assert(toolNames.includes('frame_get_payment_status'), 'Missing frame_get_payment_status');
  assert(toolNames.includes('frame_request_approval'), 'Missing frame_request_approval');
  assert(toolNames.includes('frame_list_payment_authorities'), 'Missing frame_list_payment_authorities');

  await client.close();
  console.log('\n🎉 Frame MCP Client Integration Test PASSED\n');
}

runMcpTest().catch((err) => {
  console.error('MCP Test failed:', err);
  process.exit(1);
});
