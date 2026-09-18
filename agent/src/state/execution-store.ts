import fs from 'fs';
import path from 'path';
import { AgentExecutionState } from '../core/state';
import { AgentEvent } from '../observability/events';

export interface PersistentStoreData {
  runs: Record<string, AgentExecutionState>;
  events: Record<string, AgentEvent[]>;
}

export class ExecutionStore {
  private runs = new Map<string, AgentExecutionState>();
  private events = new Map<string, AgentEvent[]>();
  private storagePath: string | null = null;

  constructor(storagePath?: string) {
    if (storagePath) {
      this.storagePath = storagePath;
    } else {
      const baseDir = process.env.AGENT_DATA_DIR || path.resolve(__dirname, '../../data');
      this.storagePath = path.join(baseDir, 'runs_store.json');
    }
    this.hydrateFromDisk();
  }

  private hydrateFromDisk(): void {
    if (!this.storagePath) return;

    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw) as PersistentStoreData;
        if (data.runs) {
          for (const [k, v] of Object.entries(data.runs)) {
            this.runs.set(k, v);
          }
        }
        if (data.events) {
          for (const [k, v] of Object.entries(data.events)) {
            this.events.set(k, v);
          }
        }
      }
    } catch (err) {
      console.warn(`[ExecutionStore] Warning: Could not hydrate from disk at ${this.storagePath}:`, err);
    }
  }

  private flushToDisk(): void {
    if (!this.storagePath) return;

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const exportData: PersistentStoreData = {
        runs: Object.fromEntries(this.runs),
        events: Object.fromEntries(this.events),
      };

      const tmpPath = `${this.storagePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(exportData, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storagePath);
    } catch (err) {
      console.error(`[ExecutionStore] Error persisting runs to disk at ${this.storagePath}:`, err);
    }
  }

  saveRun(state: AgentExecutionState): void {
    state.updatedAt = new Date().toISOString();
    this.runs.set(state.runId, { ...state });
    this.flushToDisk();
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
    this.flushToDisk();
  }

  getEvents(runId: string): AgentEvent[] {
    return this.events.get(runId) || [];
  }
}

export const defaultExecutionStore = new ExecutionStore();
