import { ProductCandidate } from './product';
import { StructuredUserIntent } from '../intent/schema';

export interface RankedProduct {
  product: ProductCandidate;
  score: number;
  isWithinBudget: boolean;
  reasons: string[];
}

/**
 * Transparent ranking algorithm:
 * - Products exceeding user budget are penalized/excluded.
 * - Out-of-stock items are penalized.
 * - Keyword matching in name/description gives points.
 * - Preferred brands give bonus points.
 * - Excluded brands are strictly disqualified.
 */
export function rankProducts(
  candidates: ProductCandidate[],
  intent: StructuredUserIntent
): RankedProduct[] {
  const ranked: RankedProduct[] = [];
  const searchTerms = intent.product_type.toLowerCase().split(/\s+/);

  for (const product of candidates) {
    let score = 50;
    const reasons: string[] = [];
    const nameLower = product.name.toLowerCase();
    const descLower = product.description.toLowerCase();

    // 1. Budget constraint check
    const isWithinBudget = product.price_paise <= intent.max_amount_paise;
    if (isWithinBudget) {
      score += 30;
      reasons.push(`Within user budget of ₹${intent.max_amount_rupees}`);
    } else {
      score -= 100;
      reasons.push(`Exceeds user budget (₹${product.price_rupees} > ₹${intent.max_amount_rupees})`);
    }

    // 2. Stock check
    if (product.in_stock) {
      score += 10;
      reasons.push('In stock');
    } else {
      score -= 50;
      reasons.push('Out of stock');
    }

    // 3. Keyword relevance
    let keywordMatches = 0;
    for (const term of searchTerms) {
      if (nameLower.includes(term)) {
        score += 15;
        keywordMatches++;
      } else if (descLower.includes(term)) {
        score += 5;
        keywordMatches++;
      }
    }
    if (keywordMatches > 0) {
      reasons.push(`Matches ${keywordMatches} query keywords`);
    }

    // 4. Excluded brands
    const isExcluded = intent.excluded_brands.some((b) => nameLower.includes(b.toLowerCase()));
    if (isExcluded) {
      score -= 200;
      reasons.push('Excluded by brand preference');
    }

    // 5. Preferred brands
    const isPreferred = intent.preferred_brands.some((b) => nameLower.includes(b.toLowerCase()));
    if (isPreferred) {
      score += 25;
      reasons.push('Matches preferred brand');
    }

    ranked.push({ product, score, isWithinBudget, reasons });
  }

  // Sort descending by score
  return ranked.sort((a, b) => b.score - a.score);
}

export function selectBestProduct(
  candidates: ProductCandidate[],
  intent: StructuredUserIntent
): { selected: ProductCandidate; reason: string } | null {
  const ranked = rankProducts(candidates, intent);
  const eligible = ranked.filter((r) => r.isWithinBudget && r.product.in_stock && r.score > 0);

  if (eligible.length === 0) {
    return null;
  }

  const best = eligible[0];
  const reason = `Selected ${best.product.name} (₹${best.product.price_rupees}) based on: ${best.reasons.join(', ')}`;
  return { selected: best.product, reason };
}
