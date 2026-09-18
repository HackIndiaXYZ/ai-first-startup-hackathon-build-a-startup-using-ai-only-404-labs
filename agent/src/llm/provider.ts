export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface LLMProvider {
  name: string;
  generateText(prompt: string, systemPrompt?: string): Promise<string>;
  generateToolCalls(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse>;
}
