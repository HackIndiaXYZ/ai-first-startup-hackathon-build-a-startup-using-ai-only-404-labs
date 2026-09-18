export interface ProductCandidate {
  id: string;
  name: string;
  description: string;
  price_rupees: number;
  price_paise: number;
  currency: string;
  category: string;
  in_stock: boolean;
  merchant_id: string;
  merchant_name: string;
  url?: string;
  rating?: number;
  attributes?: Record<string, unknown>;
}

export interface ProductComparison {
  total_discovered: number;
  candidates: ProductCandidate[];
  selected_product?: ProductCandidate;
  selection_reason?: string;
}
