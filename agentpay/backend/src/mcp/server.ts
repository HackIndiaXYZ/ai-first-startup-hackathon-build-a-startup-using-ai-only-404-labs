import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { FrameMcpTools } from './tools';
import { FrameMcpConfig } from './types';

export const FRAME_TOOLS_DEFINITIONS: Tool[] = [
  {
    name: 'frame_create_payment_intent',
    description:
      'Authorize and initiate a payment intent through Frame’s deterministic Policy Firewall. Evaluates transaction limits, budget, and merchant/category rules. Returns ALLOW, REQUIRE_APPROVAL, or DENY.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Payment amount in currency units (e.g. 2499 or 2499.50)',
        },
        amount_paise: {
          type: 'integer',
          description: 'Payment amount in minor units / paise (e.g. 249900)',
        },
        currency: {
          type: 'string',
          description: 'Currency code, defaults to INR',
          default: 'INR',
        },
        merchant: {
          type: 'string',
          description: 'Name of the merchant or payee (e.g. "Amazon")',
        },
        merchant_reference: {
          type: 'string',
          description: 'Optional merchant order reference or invoice ID',
        },
        order_reference: {
          type: 'string',
          description: 'Merchant checkout order or invoice reference',
        },
        purpose: {
          type: 'string',
          description: 'Clear statement of what is being purchased',
        },
        category: {
          type: 'string',
          description: 'Spending category (e.g. "electronics", "saas", "travel")',
        },
        idempotency_key: {
          type: 'string',
          description: 'Unique client key preventing duplicate payments',
        },
        metadata: {
          type: 'object',
          description: 'Optional key-value metadata',
        },
        agent_api_key: {
          type: 'string',
          description: 'Frame Agent API key (starts with frm_). Defaults to env variable.',
        },
      },
      required: ['merchant', 'purpose', 'idempotency_key'],
    },
  },
  {
    name: 'frame_get_payment_status',
    description:
      'Check the real-time execution status and policy decision of a payment intent in Frame.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_intent_id: {
          type: 'string',
          description: 'The Frame payment intent ID to inspect',
        },
        agent_api_key: {
          type: 'string',
          description: 'Frame Agent API key. Defaults to env variable.',
        },
      },
      required: ['payment_intent_id'],
    },
  },
  {
    name: 'frame_get_payment_intent',
    description:
      'Retrieve complete safe payment-intent information accessible to the authenticated agent. Internal secrets and provider credentials are never returned.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_intent_id: {
          type: 'string',
          description: 'The Frame payment intent ID to retrieve',
        },
        agent_api_key: {
          type: 'string',
          description: 'Frame Agent API key. Defaults to env variable.',
        },
      },
      required: ['payment_intent_id'],
    },
  },
  {
    name: 'frame_request_approval',
    description:
      'Request human review for a payment intent currently in PENDING_APPROVAL status. Agents cannot approve payments themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_intent_id: {
          type: 'string',
          description: 'The Frame payment intent ID requiring approval',
        },
        notes: {
          type: 'string',
          description: 'Optional urgency or justification notes for human approvers',
        },
        agent_api_key: {
          type: 'string',
          description: 'Frame Agent API key. Defaults to env variable.',
        },
      },
      required: ['payment_intent_id'],
    },
  },
  {
    name: 'frame_list_payment_authorities',
    description:
      'List delegated payment authorities granted by human principals to this AI agent, including transaction limits, daily/monthly spend caps, and allowed categories.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'],
          description: 'Filter by authority status (default: all)',
        },
        agent_api_key: {
          type: 'string',
          description: 'Frame Agent API key. Defaults to env variable.',
        },
      },
    },
  },
  {
    name: 'frame_get_payment_authority',
    description:
      'Inspect detailed parameters, remaining budget allowances, and category/merchant restrictions for a specific delegated PaymentAuthority.',
    inputSchema: {
      type: 'object',
      properties: {
        authority_id: {
          type: 'string',
          description: 'The unique PaymentAuthority ID to inspect',
        },
        agent_api_key: {
          type: 'string',
          description: 'Frame Agent API key. Defaults to env variable.',
        },
      },
      required: ['authority_id'],
    },
  },
];

export function createFrameMcpServer(config: FrameMcpConfig): { server: Server; tools: FrameMcpTools } {
  const server = new Server(
    {
      name: 'frame-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tools = new FrameMcpTools(config);

  // Register List Tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: FRAME_TOOLS_DEFINITIONS,
    };
  });

  // Register Call Tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let resultData: unknown;
      switch (name) {
        case 'frame_create_payment_intent':
          resultData = await tools.createPaymentIntent(args);
          break;
        case 'frame_get_payment_status':
          resultData = await tools.getPaymentStatus(args);
          break;
        case 'frame_get_payment_intent':
          resultData = await tools.getPaymentIntent(args);
          break;
        case 'frame_request_approval':
          resultData = await tools.requestApproval(args);
          break;
        case 'frame_list_payment_authorities':
          resultData = await tools.listPaymentAuthorities(args);
          break;
        case 'frame_get_payment_authority':
          resultData = await tools.getPaymentAuthority(args);
          break;
        default:
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` },
                }),
              },
            ],
          };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultData, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: {
                  code: error.code || 'TOOL_EXECUTION_ERROR',
                  message: error.message || 'An error occurred during tool execution',
                  retryable: error.retryable ?? false,
                  next_action: error.next_action ?? 'DO_NOT_RETRY',
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  });

  return { server, tools };
}
