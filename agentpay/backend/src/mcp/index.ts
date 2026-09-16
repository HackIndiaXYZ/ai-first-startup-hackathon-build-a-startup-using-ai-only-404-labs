#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFrameMcpServer } from './server';
import { config } from '../config';

async function main() {
  const apiUrl = process.env.FRAME_API_URL || `http://localhost:${config.port}/v1`;
  const agentApiKey = process.env.FRAME_AGENT_API_KEY;

  const { server } = createFrameMcpServer({
    apiUrl,
    agentApiKey,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Frame MCP Server initialized and listening on stdio (Target Frame API: ${apiUrl})`);
}

main().catch((err) => {
  console.error('Fatal error starting Frame MCP Server:', err);
  process.exit(1);
});
