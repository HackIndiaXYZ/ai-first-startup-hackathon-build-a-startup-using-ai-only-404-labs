import { z } from 'zod';

export const StructuredUserIntentSchema = z.object({
  id: z.string().min(1),
  raw_instruction: z.string().min(1),
  task: z.enum(['purchase', 'search', 'compare']).default('purchase'),
  product_type: z.string().min(1).describe('The target item or product type (e.g. "mechanical keyboard")'),
  max_amount_paise: z.number().int().positive().describe('Maximum allowed budget in paise (minor units)'),
  max_amount_rupees: z.number().positive().describe('Maximum allowed budget in rupees'),
  currency: z.string().default('INR'),
  quantity: z.number().int().positive().default(1),
  preferred_brands: z.array(z.string()).default([]),
  excluded_brands: z.array(z.string()).default([]),
  merchant_preferences: z.array(z.string()).default([]),
  required_attributes: z.record(z.unknown()).default({}),
  delivery_constraints: z.array(z.string()).default([]),
  autonomous_purchase: z.boolean().default(true),
  created_at: z.string(),
});

export type StructuredUserIntent = z.infer<typeof StructuredUserIntentSchema>;
