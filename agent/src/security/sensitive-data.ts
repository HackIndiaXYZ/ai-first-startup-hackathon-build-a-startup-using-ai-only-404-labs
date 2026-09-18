export const PROHIBITED_CREDENTIAL_KEYS = [
  'pin',
  'upi_pin',
  'upipin',
  'otp',
  'cvv',
  'cvc',
  'password',
  'bank_password',
  'card_pin',
  'card_number',
  'credit_card',
  'secret',
  'private_key',
  'passcode',
];

export class SensitiveCredentialError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'SensitiveCredentialError';
    this.code = 'SENSITIVE_CREDENTIAL_REJECTED';
  }
}

/**
 * Deeply scans an arbitrary object, array, or string to ensure zero sensitive payment credentials
 * (UPI PIN, OTP, CVV, passwords) are present. Throws SensitiveCredentialError if detected.
 */
export function assertNoSensitiveData(obj: unknown, path = ''): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    const lower = obj.toLowerCase();
    // Check for explicit credential patterns e.g. "upi pin is 1234" or "otp: 9999"
    if (
      lower.includes('upi_pin') ||
      lower.includes('upipin') ||
      /(\bupi\s*pin\b|\botp\b|\bcvv\b|\bpasscode\b)\s*[:=]\s*\d+/i.test(obj)
    ) {
      throw new SensitiveCredentialError(
        `Security violation at '${path || 'payload'}': Sensitive payment credentials detected in payload string.`
      );
    }
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => assertNoSensitiveData(item, `${path}[${idx}]`));
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
      for (const prohibited of PROHIBITED_CREDENTIAL_KEYS) {
        if (normalizedKey === prohibited || normalizedKey.includes(prohibited)) {
          throw new SensitiveCredentialError(
            `Security violation: Field '${path ? `${path}.${key}` : key}' contains prohibited sensitive payment credential.`
          );
        }
      }
      assertNoSensitiveData(value, path ? `${path}.${key}` : key);
    }
  }
}
