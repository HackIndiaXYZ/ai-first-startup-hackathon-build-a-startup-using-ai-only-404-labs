import { ulid } from 'ulid';
import { StructuredUserIntent } from './schema';
import { validateAndLockIntent } from './validator';
import { LLMProvider } from '../llm/provider';

/**
 * Parses a natural language user instruction into a locked StructuredUserIntent.
 */
export async function parseUserIntent(
  rawInstruction: string,
  llm?: LLMProvider
): Promise<Readonly<StructuredUserIntent>> {
  const trimmed = rawInstruction.trim();
  if (!trimmed) {
    throw new Error('User instruction cannot be empty');
  }

  // 1. If LLM provider is available, use LLM structured extraction
  if (llm) {
    try {
      const prompt = `Extract shopping intent from this instruction as JSON.
User instruction: "${trimmed}"

Format your response strictly as JSON with this schema:
{
  "task": "purchase" | "search" | "compare",
  "product_type": string,
  "max_amount_rupees": number,
  "currency": "INR",
  "quantity": number,
  "preferred_brands": string[],
  "required_attributes": object
}

Example for "Buy me a mechanical keyboard under ₹3,000":
{
  "task": "purchase",
  "product_type": "mechanical keyboard",
  "max_amount_rupees": 3000,
  "currency": "INR",
  "quantity": 1,
  "preferred_brands": [],
  "required_attributes": {}
}

Output ONLY valid JSON. No markdown backticks, no commentary.`;

      const response = await llm.generateText(prompt);
      const cleaned = response.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      const maxRupees = typeof parsed.max_amount_rupees === 'number' ? parsed.max_amount_rupees : 5000;
      const intent: StructuredUserIntent = {
        id: `intent_${ulid()}`,
        raw_instruction: trimmed,
        task: parsed.task || 'purchase',
        product_type: parsed.product_type || 'item',
        max_amount_rupees: maxRupees,
        max_amount_paise: Math.round(maxRupees * 100),
        currency: parsed.currency || 'INR',
        quantity: parsed.quantity || 1,
        preferred_brands: parsed.preferred_brands || [],
        excluded_brands: parsed.excluded_brands || [],
        merchant_preferences: parsed.merchant_preferences || [],
        required_attributes: parsed.required_attributes || {},
        delivery_constraints: [],
        autonomous_purchase: true,
        created_at: new Date().toISOString(),
      };

      return validateAndLockIntent(intent);
    } catch {
      // Fallback to deterministic regex extractor on LLM parse error
    }
  }

  // 2. Deterministic heuristic / Regex extraction (robust fallback)
  return parseIntentDeterministic(trimmed);
}

/**
 * Deterministic regex parser for user purchasing instructions.
 */
export function parseIntentDeterministic(rawInstruction: string): Readonly<StructuredUserIntent> {
  const trimmed = rawInstruction.trim();

  // Extract amount: e.g. "under ₹3,000", "below 3000", "under rs. 2500", "max budget 1500", "max 3000 rupees"
  let maxAmountRupees = 5000; // default cap if unspecified
  const amountMatch = trimmed.match(/(?:under|below|max\s+budget|budget|max|within|upto|up to)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i) ||
    trimmed.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i);

  if (amountMatch && amountMatch[1]) {
    const parsedNum = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (!isNaN(parsedNum) && parsedNum > 0) {
      maxAmountRupees = parsedNum;
    }
  }

  // Extract product type
  let productType = trimmed
    .replace(/^(buy|purchase|get|order|find)\s+(me\s+)?(a\s+|an\s+|the\s+)?/i, '')
    .replace(/(?:under|below|max\s+budget|budget|max|within|upto|up to)\s*(?:₹|rs\.?|inr)?\s*[\d,]+.*$/i, '')
    .trim();

  if (!productType) {
    productType = 'product';
  }

  const intent: StructuredUserIntent = {
    id: `intent_${ulid()}`,
    raw_instruction: trimmed,
    task: 'purchase',
    product_type: productType,
    max_amount_rupees: maxAmountRupees,
    max_amount_paise: Math.round(maxAmountRupees * 100),
    currency: 'INR',
    quantity: 1,
    preferred_brands: [],
    excluded_brands: [],
    merchant_preferences: [],
    required_attributes: {},
    delivery_constraints: [],
    autonomous_purchase: true,
    created_at: new Date().toISOString(),
  };

  return validateAndLockIntent(intent);
}
