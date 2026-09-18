import { LLMProvider, LLMMessage, ToolDefinition, LLMResponse, ToolCall } from './provider';

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  public readonly name = 'openai-compatible';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: OpenAICompatibleConfig = {}) {
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || '';
    this.baseUrl = (config.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = config.model || process.env.LLM_MODEL || 'gpt-4o-mini';
  }

  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM API request failed: HTTP ${res.status} - ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content || '';
  }

  async generateToolCalls(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const formattedMessages: Array<{ role: string; content: string; tool_call_id?: string }> = [];
    if (systemPrompt) formattedMessages.push({ role: 'system', content: systemPrompt });

    for (const m of messages) {
      formattedMessages.push({
        role: m.role,
        content: m.content,
        tool_call_id: m.tool_call_id,
      });
    }

    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: formattedMessages,
        tools: formattedTools,
        tool_choice: 'auto',
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM Tool Call request failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0]?.message;
    const content = choice?.content || '';
    const rawCalls = choice?.tool_calls || [];

    const toolCalls: ToolCall[] = rawCalls.map((c: any) => ({
      id: c.id,
      name: c.function.name,
      arguments: JSON.parse(c.function.arguments || '{}'),
    }));

    return { content, toolCalls };
  }
}
