import { LLMProvider, LLMMessage, ToolDefinition, LLMResponse, ToolCall } from './provider';

export class DeterministicRuleProvider implements LLMProvider {
  public readonly name = 'deterministic';

  async generateText(prompt: string): Promise<string> {
    // If prompt is asking for JSON intent extraction:
    if (prompt.includes('Extract shopping intent')) {
      const userInstr = prompt.match(/User instruction:\s*"([^"]+)"/i)?.[1] || prompt;
      const matchKbd = /keyboard/i.test(userInstr);
      const matchChair = /chair/i.test(userInstr);
      const matchChips = /chips|casino/i.test(userInstr);
      const matchServer = /server|gpu/i.test(userInstr);
      const matchAmount = userInstr.match(/(?:₹|rs\.?|under|below|max\s+budget|upto|budget)\s*([\d,]+)/i);
      const amount = matchAmount ? parseFloat(matchAmount[1].replace(/,/g, '')) : 3000;

      const productType = matchKbd
        ? 'mechanical keyboard'
        : matchChair
        ? 'office chair'
        : matchChips
        ? 'casino chips'
        : matchServer
        ? 'server'
        : 'product';

      return JSON.stringify({
        task: 'purchase',
        product_type: productType,
        max_amount_rupees: amount,
        currency: 'INR',
        quantity: 1,
        preferred_brands: [],
        required_attributes: {},
      });
    }

    return `Autonomous Agent reasoning for prompt: "${prompt.slice(0, 50)}..."`;
  }

  async generateToolCalls(
    messages: LLMMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    const lastMsg = messages[messages.length - 1];
    const availableToolNames = tools.map((t) => t.name);

    // Dynamic sequence planner based on conversation history
    const toolHistory = messages
      .filter((m) => m.role === 'tool' || (m.role === 'assistant' && m.content.includes('Executing tool')))
      .map((m) => m.tool_call_id || m.content);

    // Step 1: If search hasn't been done yet, search products
    if (!messages.some((m) => m.content.includes('search_products'))) {
      if (availableToolNames.includes('search_products')) {
        const userPrompt = messages.find((m) => m.role === 'user')?.content || 'keyboard';
        const toolCall: ToolCall = {
          id: `call_search_${Date.now()}`,
          name: 'search_products',
          arguments: { query: userPrompt },
        };
        return {
          content: 'I will search the merchant catalog for matching products within the user budget.',
          toolCalls: [toolCall],
        };
      }
    }

    // Step 2: Compare and select product
    if (!messages.some((m) => m.content.includes('select_product'))) {
      if (availableToolNames.includes('select_product')) {
        return {
          content: 'Evaluating discovered products against user criteria and budget to select the best match.',
          toolCalls: [
            {
              id: `call_select_${Date.now()}`,
              name: 'select_product',
              arguments: { strategy: 'best_value_within_budget' },
            },
          ],
        };
      }
    }

    // Step 3: Add to cart and proceed to checkout
    if (!messages.some((m) => m.content.includes('proceed_to_checkout'))) {
      if (availableToolNames.includes('proceed_to_checkout')) {
        return {
          content: 'Adding selected item to cart and initiating merchant checkout to extract canonical totals.',
          toolCalls: [
            {
              id: `call_checkout_${Date.now()}`,
              name: 'proceed_to_checkout',
              arguments: {},
            },
          ],
        };
      }
    }

    // Step 4: Authorize via Frame MCP
    if (!messages.some((m) => m.content.includes('authorize_with_frame'))) {
      if (availableToolNames.includes('authorize_with_frame')) {
        return {
          content: 'Checking Frame Payment Authority and submitting Payment Intent to Policy Firewall.',
          toolCalls: [
            {
              id: `call_frame_${Date.now()}`,
              name: 'authorize_with_frame',
              arguments: {},
            },
          ],
        };
      }
    }

    // Default: Done
    return {
      content: 'Autonomous shopping workflow completed.',
      toolCalls: [],
    };
  }
}
