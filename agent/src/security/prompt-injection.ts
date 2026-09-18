export interface InjectionScanResult {
  isSuspicious: boolean;
  patternsFound: string[];
  sanitizedText: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /disregard\s+(the\s+)?(budget|price\s+limit|user\s+intent|rules)/i,
  /bypass\s+(frame|policy|firewall|approval|threshold)/i,
  /system\s+prompt\s+override/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /send\s+(money|funds|payment|crypto)\s+to/i,
  /transfer\s+(all|funds|rupees|paise)\s+to/i,
  /secret\s+instructions/i,
  /execute\s+script/i,
  /buy\s+this\s+.*instead\s+of\s+user/i,
];

export class PromptInjectionError extends Error {
  code: string;
  patterns: string[];
  constructor(message: string, patterns: string[]) {
    super(message);
    this.name = 'PromptInjectionError';
    this.code = 'UNTRUSTED_CONTENT_INJECTION_DETECTED';
    this.patterns = patterns;
  }
}

/**
 * Scans untrusted webpage content (titles, product descriptions, reviews, hidden comments)
 * and returns whether adversarial prompt injection patterns are present.
 */
export function scanUntrustedContent(content: string, strict = false): InjectionScanResult {
  if (!content) {
    return { isSuspicious: false, patternsFound: [], sanitizedText: '' };
  }

  const matches: string[] = [];
  for (const regex of INJECTION_PATTERNS) {
    const match = content.match(regex);
    if (match) {
      matches.push(match[0]);
    }
  }

  // Strip potential script tags or hidden HTML elements
  const sanitized = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  if (matches.length > 0 && strict) {
    throw new PromptInjectionError(
      `Untrusted web content failed security scan. Detected prompt injection: ${matches.join(', ')}`,
      matches
    );
  }

  return {
    isSuspicious: matches.length > 0,
    patternsFound: matches,
    sanitizedText: sanitized,
  };
}
