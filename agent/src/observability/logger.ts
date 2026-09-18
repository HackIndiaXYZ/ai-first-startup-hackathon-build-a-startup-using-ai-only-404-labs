export interface LoggerOptions {
  runId?: string;
  prefix?: string;
}

export class AgentLogger {
  private runId: string;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.runId = options.runId || 'system';
    this.prefix = options.prefix || 'FrameAgent';
  }

  private format(level: string, message: string, detail?: unknown): string {
    const timestamp = new Date().toISOString().slice(11, 19);
    const detailStr = detail ? ` | ${typeof detail === 'object' ? JSON.stringify(detail) : detail}` : '';
    return `[${timestamp}] [${this.prefix}] [${this.runId}] [${level}] ${message}${detailStr}`;
  }

  info(message: string, detail?: unknown): void {
    console.log(this.format('INFO', message, detail));
  }

  warn(message: string, detail?: unknown): void {
    console.warn(this.format('WARN', message, detail));
  }

  error(message: string, detail?: unknown): void {
    console.error(this.format('ERROR', message, detail));
  }

  debug(message: string, detail?: unknown): void {
    if (process.env.DEBUG) {
      console.debug(this.format('DEBUG', message, detail));
    }
  }
}
