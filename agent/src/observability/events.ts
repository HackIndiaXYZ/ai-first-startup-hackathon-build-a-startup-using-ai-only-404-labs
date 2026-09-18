import { EventEmitter } from 'events';

export type AgentEventType =
  | 'agent.started'
  | 'intent.created'
  | 'intent.validated'
  | 'search.started'
  | 'search.completed'
  | 'product.found'
  | 'product.selected'
  | 'cart.updated'
  | 'checkout.started'
  | 'checkout.canonicalized'
  | 'intent.binding.checked'
  | 'frame.authority.checked'
  | 'frame.payment_intent.created'
  | 'frame.decision.received'
  | 'approval.requested'
  | 'approval.checked'
  | 'approval.granted'
  | 'approval.rejected'
  | 'approval.pending'
  | 'tool.invoked'
  | 'tool.error'
  | 'payment.started'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.unknown'
  | 'order.completed'
  | 'human.intervention.required'
  | 'agent.cancelled'
  | 'agent.completed'
  | 'agent.failed';

export interface AgentEvent<T = unknown> {
  id: string;
  runId: string;
  type: AgentEventType;
  timestamp: string;
  data: T;
  message: string;
  detail?: string;
}

export class AgentEventBus extends EventEmitter {
  private runId: string;

  constructor(runId: string) {
    super();
    this.runId = runId;
  }

  emitEvent<T = unknown>(type: AgentEventType, message: string, data?: T, detail?: string): AgentEvent<T> {
    const event: AgentEvent<T> = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      runId: this.runId,
      type,
      timestamp: new Date().toISOString(),
      data: data as T,
      message,
      detail,
    };
    this.emit(type, event);
    this.emit('*', event);
    return event;
  }
}
