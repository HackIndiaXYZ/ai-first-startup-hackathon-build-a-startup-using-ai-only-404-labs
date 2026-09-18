export interface CostLimits {
  maxRuntimeMs?: number; // e.g. 120000 (2 minutes)
  maxLlmIterations?: number; // e.g. 15
  maxToolCalls?: number; // e.g. 25
  maxBrowserActions?: number; // e.g. 20
}

export class CostControlError extends Error {
  public readonly code = 'COST_LIMIT_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'CostControlError';
  }
}

export class CostController {
  private startTime: number;
  private llmIterations = 0;
  private toolCalls = 0;
  private browserActions = 0;
  private isCancelled = false;
  private limits: Required<CostLimits>;

  constructor(limits: CostLimits = {}) {
    this.startTime = Date.now();
    this.limits = {
      maxRuntimeMs: limits.maxRuntimeMs ?? 120000,
      maxLlmIterations: limits.maxLlmIterations ?? 15,
      maxToolCalls: limits.maxToolCalls ?? 25,
      maxBrowserActions: limits.maxBrowserActions ?? 20,
    };
  }

  cancel(): void {
    this.isCancelled = true;
  }

  checkLiveness(): void {
    if (this.isCancelled) {
      throw new CostControlError('Agent execution was cancelled by human principal or system supervisor.');
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.limits.maxRuntimeMs) {
      throw new CostControlError(
        `Agent execution runtime exceeded safety limit of ${this.limits.maxRuntimeMs / 1000}s (elapsed: ${Math.round(elapsed / 1000)}s). Halting.`
      );
    }
  }

  recordLlmIteration(): void {
    this.checkLiveness();
    this.llmIterations++;
    if (this.llmIterations > this.limits.maxLlmIterations) {
      throw new CostControlError(
        `LLM reasoning iterations exceeded safety limit of ${this.limits.maxLlmIterations}. Halting runaway agent.`
      );
    }
  }

  recordToolCall(): void {
    this.checkLiveness();
    this.toolCalls++;
    if (this.toolCalls > this.limits.maxToolCalls) {
      throw new CostControlError(
        `Total tool invocations exceeded safety limit of ${this.limits.maxToolCalls}. Halting runaway agent.`
      );
    }
  }

  recordBrowserAction(): void {
    this.checkLiveness();
    this.browserActions++;
    if (this.browserActions > this.limits.maxBrowserActions) {
      throw new CostControlError(
        `Browser automation actions exceeded safety limit of ${this.limits.maxBrowserActions}. Halting.`
      );
    }
  }

  getMetrics() {
    return {
      elapsedMs: Date.now() - this.startTime,
      llmIterations: this.llmIterations,
      toolCalls: this.toolCalls,
      browserActions: this.browserActions,
      limits: this.limits,
    };
  }
}
