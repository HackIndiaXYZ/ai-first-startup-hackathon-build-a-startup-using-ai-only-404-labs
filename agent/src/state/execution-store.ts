import { AgentExecutionState } from '../core/state';
import { AgentEvent } from '../observability/events';

export class ExecutionStore {
  private runs = new Map<string, AgentExecutionState>();
  private events = new Map<string, AgentEvent[]>();

  saveRun(state: AgentExecutionState): void {
    state.updatedAt = new Date().toISOString();
    this.runs.set(state.runId, { ...state });
  }

  getRun(runId: string): AgentExecutionState | undefined {
    const run = this.runs.get(runId);
    return run ? { ...run } : undefined;
  }

  listRuns(): AgentExecutionState[] {
    return Array.from(this.runs.values());
  }

  addEvent(runId: string, event: AgentEvent): void {
    const list = this.events.get(runId) || [];
    list.push(event);
    this.events.set(runId, list);
  }

  getEvents(runId: string): AgentEvent[] {
    return this.events.get(runId) || [];
  }
}

export const defaultExecutionStore = new ExecutionStore();
