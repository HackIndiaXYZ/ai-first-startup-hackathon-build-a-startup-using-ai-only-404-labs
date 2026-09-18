import { StructuredUserIntent } from '../intent/schema';
import { ProductCandidate } from '../shopping/product';
import { CanonicalCheckout } from '../checkout/checkout-extractor';
import { CreatePaymentIntentResult } from '../frame/frame-mcp-client';

export type AgentExecutionStatus =
  | 'INITIALIZING'
  | 'PARSING_INTENT'
  | 'SEARCHING_CATALOG'
  | 'COMPARING_PRODUCTS'
  | 'PRODUCT_SELECTED'
  | 'CARTING_ITEM'
  | 'CHECKING_OUT'
  | 'CANONICALIZING_CHECKOUT'
  | 'BINDING_VERIFICATION'
  | 'CHECKING_FRAME_AUTHORITY'
  | 'CREATING_PAYMENT_INTENT'
  | 'WAITING_FOR_HUMAN_APPROVAL'
  | 'WAITING_FOR_HUMAN'
  | 'EXECUTING_PAYMENT'
  | 'CONFIRMING_ORDER'
  | 'SUCCEEDED'
  | 'CANCELLED'
  | 'FAILED'
  | 'TERMINATED_BY_POLICY'
  | 'TERMINATED_BY_SECURITY';

export interface AgentExecutionState {
  runId: string;
  conversationId: string;
  rawInstruction: string;
  status: AgentExecutionStatus;
  userIntent?: Readonly<StructuredUserIntent>;
  discoveredProducts: ProductCandidate[];
  selectedProduct?: ProductCandidate;
  selectionReason?: string;
  canonicalCheckout?: CanonicalCheckout;
  framePaymentIntent?: CreatePaymentIntentResult;
  orderConfirmation?: {
    orderId: string;
    merchant: string;
    amount: number;
    currency: string;
    status: string;
    confirmedAt: string;
  };
  humanInterventionRequired?: {
    reason: string;
    question?: string;
    paymentIntentId?: string;
    requestedAt: string;
  };
  error?: {
    code: string;
    message: string;
    step: AgentExecutionStatus;
  };
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
