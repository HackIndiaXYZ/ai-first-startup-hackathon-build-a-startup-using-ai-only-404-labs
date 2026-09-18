import { StructuredUserIntent, StructuredUserIntentSchema } from './schema';

export class IntentValidationError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'IntentValidationError';
    this.code = 'INTENT_VALIDATION_FAILED';
  }
}

/**
 * Validates a parsed user intent and freezes the object to prevent runtime modification.
 */
export function validateAndLockIntent(intent: StructuredUserIntent): Readonly<StructuredUserIntent> {
  const result = StructuredUserIntentSchema.safeParse(intent);
  if (!result.success) {
    const errorDetails = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new IntentValidationError(`Invalid user intent structure: ${errorDetails}`);
  }

  if (intent.max_amount_paise <= 0 || intent.max_amount_rupees <= 0) {
    throw new IntentValidationError('Budget limit must be a positive number.');
  }

  if (Math.round(intent.max_amount_rupees * 100) !== intent.max_amount_paise) {
    throw new IntentValidationError(
      `Budget discrepancy between rupees (₹${intent.max_amount_rupees}) and paise (${intent.max_amount_paise}).`
    );
  }

  // Deep freeze the intent object to guarantee immutability across the agent execution lifetime
  return Object.freeze(JSON.parse(JSON.stringify(result.data)));
}
