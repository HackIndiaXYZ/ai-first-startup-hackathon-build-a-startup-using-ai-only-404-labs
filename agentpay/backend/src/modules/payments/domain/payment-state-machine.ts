// Strict Payment State Machine

import { PaymentIntentStatus, PaymentExecutionStatus } from './payment.entity';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly entityType: 'PaymentIntent' | 'Payment',
    public readonly currentStatus: string,
    public readonly targetStatus: string,
    public readonly reason?: string
  ) {
    super(
      `Invalid ${entityType} state transition from "${currentStatus}" to "${targetStatus}". ${reason || ''}`.trim()
    );
    this.name = 'InvalidStateTransitionError';
  }
}

// ── Payment Intent State Machine ───────────────────────

const VALID_INTENT_TRANSITIONS: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  CREATED: ['EVALUATING', 'CANCELLED', 'EXPIRED'],
  EVALUATING: ['AUTHORIZED', 'PENDING_APPROVAL', 'DENIED', 'FAILED'],
  PENDING_APPROVAL: ['AUTHORIZED', 'REJECTED', 'EXPIRED'],
  AUTHORIZED: ['EXECUTING', 'CANCELLED', 'EXPIRED'],
  EXECUTING: ['SUCCEEDED', 'FAILED', 'EXECUTING'], // Stays EXECUTING if provider is UNKNOWN
  DENIED: [],      // Terminal
  REJECTED: [],    // Terminal
  SUCCEEDED: [],   // Terminal
  FAILED: [],      // Terminal
  EXPIRED: [],     // Terminal
  CANCELLED: [],   // Terminal
};

export const TERMINAL_INTENT_STATES: ReadonlySet<PaymentIntentStatus> = new Set([
  'DENIED',
  'REJECTED',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);

export class PaymentIntentStateMachine {
  static canTransition(current: PaymentIntentStatus, target: PaymentIntentStatus): boolean {
    if (current === target) return true;
    const allowed = VALID_INTENT_TRANSITIONS[current] || [];
    return allowed.includes(target);
  }

  static assertCanTransition(current: PaymentIntentStatus, target: PaymentIntentStatus): void {
    if (!this.canTransition(current, target)) {
      throw new InvalidStateTransitionError(
        'PaymentIntent',
        current,
        target,
        TERMINAL_INTENT_STATES.has(current)
          ? `Status "${current}" is a terminal financial state and cannot be mutated.`
          : undefined
      );
    }
  }

  static isTerminal(status: PaymentIntentStatus): boolean {
    return TERMINAL_INTENT_STATES.has(status);
  }
}

// ── Payment Execution State Machine ────────────────────

const VALID_PAYMENT_TRANSITIONS: Record<PaymentExecutionStatus, readonly PaymentExecutionStatus[]> = {
  pending: ['processing', 'failed', 'unknown'],
  processing: ['succeeded', 'failed', 'unknown'],
  unknown: ['succeeded', 'failed'], // Resolved via reconciliation or webhook ONLY
  succeeded: [], // Terminal
  failed: [],    // Terminal
};

export const TERMINAL_PAYMENT_STATES: ReadonlySet<PaymentExecutionStatus> = new Set([
  'succeeded',
  'failed',
]);

export class PaymentStateMachine {
  static canTransition(current: PaymentExecutionStatus, target: PaymentExecutionStatus): boolean {
    if (current === target) return true;
    const allowed = VALID_PAYMENT_TRANSITIONS[current] || [];
    return allowed.includes(target);
  }

  static assertCanTransition(current: PaymentExecutionStatus, target: PaymentExecutionStatus): void {
    if (!this.canTransition(current, target)) {
      throw new InvalidStateTransitionError(
        'Payment',
        current,
        target,
        TERMINAL_PAYMENT_STATES.has(current)
          ? `Payment status "${current}" is terminal and cannot be changed.`
          : undefined
      );
    }
  }

  static isTerminal(status: PaymentExecutionStatus): boolean {
    return TERMINAL_PAYMENT_STATES.has(status);
  }

  /**
   * Financial Safety Invariant:
   * An UNKNOWN state must NEVER be automatically coerced to FAILED without
   * active verification from the payment provider.
   */
  static isUnknown(status: PaymentExecutionStatus): boolean {
    return status === 'unknown';
  }
}
