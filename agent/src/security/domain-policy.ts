export const DEFAULT_PROHIBITED_CATEGORIES = [
  'gambling',
  'casino',
  'betting',
  'adult',
  'weapons',
  'narcotics',
  'unregistered_crypto',
];

export class DomainPolicyError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'DomainPolicyError';
    this.code = 'DOMAIN_POLICY_VIOLATION';
  }
}

export function assertAllowedCategory(category?: string, allowedCategories?: string[]): void {
  if (!category) return;

  const normalized = category.toLowerCase().trim();

  // Check against prohibited categories
  for (const prohibited of DEFAULT_PROHIBITED_CATEGORIES) {
    if (normalized === prohibited || normalized.includes(prohibited)) {
      throw new DomainPolicyError(
        `Category '${category}' is strictly prohibited by security policy (prohibited list: ${prohibited}).`
      );
    }
  }

  // Check against explicit allowlist if defined
  if (allowedCategories && allowedCategories.length > 0) {
    const isAllowed = allowedCategories.some(
      (c) => c.toLowerCase().trim() === normalized || normalized.includes(c.toLowerCase().trim())
    );
    if (!isAllowed) {
      throw new DomainPolicyError(
        `Category '${category}' is not in authorized category list [${allowedCategories.join(', ')}].`
      );
    }
  }
}

export function assertAllowedMerchant(merchant: string, blockedMerchants?: string[], allowedMerchants?: string[]): void {
  const normalized = merchant.toLowerCase().trim();

  if (blockedMerchants && blockedMerchants.length > 0) {
    const isBlocked = blockedMerchants.some((b) => normalized.includes(b.toLowerCase().trim()));
    if (isBlocked) {
      throw new DomainPolicyError(`Merchant '${merchant}' is on the blocked merchants list.`);
    }
  }

  if (allowedMerchants && allowedMerchants.length > 0) {
    const isAllowed = allowedMerchants.some((a) => normalized.includes(a.toLowerCase().trim()));
    if (!isAllowed) {
      throw new DomainPolicyError(`Merchant '${merchant}' is not in the allowed merchants list.`);
    }
  }
}

/**
 * SSRF Prevention: Ensures the browser automation layer does not access
 * internal metadata endpoints, private IP ranges, or unauthorized local ports.
 */
export function assertAllowedMerchantDomain(urlStr: string, allowedDomains?: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new DomainPolicyError(`Invalid merchant navigation URL: ${urlStr}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port;

  // Cloud metadata endpoints
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname.includes('metadata.google') ||
    hostname.includes('instance-data')
  ) {
    throw new DomainPolicyError(`SSRF Violation: Access to cloud metadata endpoint '${hostname}' is prohibited.`);
  }

  // Private IPv4 ranges
  const isPrivateIp =
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.startsWith('127.') ||
    hostname === '0.0.0.0' ||
    hostname === '::1';

  if (isPrivateIp || hostname === 'localhost') {
    // Only local demo merchant on port 3002 is permitted for local development/testing
    const isLocalDemoStore = (hostname === 'localhost' || hostname === '127.0.0.1') && port === '3002';
    if (!isLocalDemoStore) {
      throw new DomainPolicyError(
        `SSRF Violation: Browser navigation to private/internal network resource '${hostname}${port ? ':' + port : ''}' is prohibited.`
      );
    }
  }

  // Explicit domain allowlist
  if (allowedDomains && allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
    if (!isAllowed) {
      throw new DomainPolicyError(
        `Domain '${hostname}' is not on the authorized merchant domain allowlist [${allowedDomains.join(', ')}].`
      );
    }
  }
}
