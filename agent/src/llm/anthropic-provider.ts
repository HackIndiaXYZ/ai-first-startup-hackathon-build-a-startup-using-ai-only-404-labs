import { LLMProvider, LLMMessage, ToolDefinition, LLMResponse, ToolCall } from './provider';

export interface AnthropicConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class AnthropicProvider implements LLMProvider {
  public readonly name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: AnthropicConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = (config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.model = config.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API request failed: HTTP ${res.status} - ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    const textBlock = data.content?.find((c: any) => c.type === 'text');
    return textBlock?.text || '';
  }

  async generateToolCalls(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const formattedMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    for (const m of messages) {
      if (m.role === 'tool') {
        formattedMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        });
      } else if (m.role === 'assistant' || m.role === 'user') {
        formattedMessages.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    const formattedTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: formattedMessages,
        tools: formattedTools,
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic Tool Call failed: HTTP ${res.status} - ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input || {},
        });
      }
    }

    return { content, toolCalls };
  }
}
