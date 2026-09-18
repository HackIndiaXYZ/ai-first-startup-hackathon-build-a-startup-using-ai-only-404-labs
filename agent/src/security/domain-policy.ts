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
