import { z } from "zod";
import { RISK_CODES } from "./guidelines";

export const SOURCES = [
  "customer_stated", // the customer said it explicitly
  "product_page", // read from structured data on a product page
  "page_text", // read from free text on a page
  "image_estimate", // estimated from a photo
  "inferred", // reasonable guess from context
  "unknown",
] as const;
export type Source = (typeof SOURCES)[number];

const numField = z.object({
  value: z.number().nullable(),
  confidence: z.number().describe("0.0-1.0: how sure you are this value is correct"),
  source: z.enum(SOURCES),
  evidence: z.string().describe("Short quote or reason supporting the value"),
});
const strField = z.object({
  value: z.string().nullable(),
  confidence: z.number().describe("0.0-1.0: how sure you are this value is correct"),
  source: z.enum(SOURCES),
  evidence: z.string().describe("Short quote or reason supporting the value"),
});

export const AnalysisSchema = z.object({
  intent: z.enum(["quote", "product_question", "tracking", "complaint", "smalltalk", "other"]),
  shipment: z.object({
    origin_country: strField,
    destination_country: strField,
    contents: strField.describe("What is being shipped, in a few words"),
    weight_kg: numField.describe("Packed weight per parcel in kg"),
    length_cm: numField,
    width_cm: numField,
    height_cm: numField,
    declared_value_eur: numField,
    parcel_count: numField.describe(
      "Parcels in THIS shipment. Monthly/recurring volume is NOT a parcel count - flag volume_customer instead.",
    ),
    urgency: z.object({
      value: z.enum(["cheapest", "balanced", "fastest"]).nullable(),
      confidence: z.number(),
      source: z.enum(SOURCES),
      evidence: z.string(),
    }),
    is_fragile: z.boolean(),
    is_business: z.boolean(),
  }),
  risk_flags: z.array(z.object({ code: z.enum(RISK_CODES), detail: z.string() })),
  recommended_product_id: z.string().nullable().describe("Product id from the catalog, or null"),
  recommendation_reason: z.string(),
  suggested_add_on_ids: z.array(z.string()),
  answer_confidence: z
    .number()
    .describe("0.0-1.0: confidence that your reply is correct and complete per the guidelines"),
  uncertainty_notes: z.string().describe("What you are unsure about, or empty string"),
  missing_info_question: z
    .string()
    .nullable()
    .describe("ONE question to ask the customer for info only they know (e.g. destination), or null"),
  packaging_note: z
    .string()
    .describe("One or two sentences of packaging advice for this item (what it needs to travel safely), or empty"),
  reply: z
    .string()
    .describe("Customer-facing reply. No prices or numbers for cost - the system attaches the quote."),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export type Shipment = Analysis["shipment"];

export interface QuoteLine {
  label: string;
  amount: number;
}
export interface ProductQuote {
  productId: string;
  productName: string;
  tagline: string;
  transit: string;
  chargeableWeightKg: number;
  lines: QuoteLine[];
  totalExVat: number;
  totalIncVat: number;
  /** Price at the low/high end of the uncertainty band, if any */
  range?: { low: number; high: number };
}
export interface PackagingSuggestion {
  id: string;
  reason: string;
}

export interface QuoteExtra {
  id: string;
  name: string;
  description: string;
  price: number; // incl. VAT
  suggested: boolean;
  selected: boolean;
  reason?: string;
}

export interface QuoteResult {
  zone: string;
  /** The product the order is priced on (the customer's choice, or our recommendation) */
  recommended: ProductQuote | null;
  /** The product we would recommend */
  recommendedId: string | null;
  alternatives: ProductQuote[];
  options: ProductQuote[];
  addOns: QuoteExtra[];
  packaging: QuoteExtra[];
  customsNote: boolean;
  validUntil: string;
  /** Freight + selected add-ons + selected packaging, incl. VAT */
  grandTotal: number;
  grandRange?: { low: number; high: number };
}

export interface Selection {
  productId: string | null;
  addOnIds: string[] | null; // null = use our suggestions
  packagingIds: string[] | null;
}

export interface Answers {
  description: string;
  link: string;
  fromPostcode: string;
  toPostcode: string;
  urgency: "cheapest" | "balanced" | "fastest";
  alreadyPacked: "yes" | "no" | "unsure";
  fragile: "yes" | "no" | "unsure";
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  valueEur: number | null;
  parcels: number;
}

export interface Address {
  name: string;
  street: string;
  postcode: string;
  city: string;
  email: string;
  phone?: string;
}

export interface Order {
  id: string;
  conversationId: string;
  createdAt: string;
  status: "confirmed" | "pending_review";
  productId: string;
  productName: string;
  shipment: Shipment;
  addOnIds: string[];
  packagingIds: string[];
  total: number;
  sender: Address;
  recipient: Address;
  ticketId?: string | null;
  note?: string;
}

export type PartName = "understanding" | "recommendation" | "price" | "policy" | "answer";
export type Level = "high" | "medium" | "low";

export interface PartScore {
  part: PartName;
  label: string;
  score: number; // 0..1
  level: Level;
  reasons: string[];
  delegated: boolean;
}

export interface ConfidenceReport {
  overall: number;
  level: Level;
  parts: PartScore[];
  decision: "auto" | "ask_customer" | "delegate";
  delegatedParts: PartName[];
  hardFlags: string[];
}

export interface Attachment {
  kind: "image" | "link";
  name: string;
  /** data URL for images (kept only for the turn it was sent in) */
  dataUrl?: string;
  url?: string;
  summary?: string;
}

export type Role = "customer" | "assistant" | "human" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  at: string;
  attachments?: Attachment[];
  quote?: QuoteResult | null;
  confidence?: ConfidenceReport | null;
  ticketId?: string | null;
  agentName?: string;
}

export interface Ticket {
  id: string;
  conversationId: string;
  kind: "support" | "sales";
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt?: string;
  parts: PartName[];
  reasons: string[];
  aiDraft: string;
  quote: QuoteResult | null;
  shipment: Shipment | null;
  confidence: ConfidenceReport | null;
  resolution?: string;
  agentName?: string;
}

export interface Conversation {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
  shipment: Shipment | null;
  mode: "ai" | "mock";
  answers?: Answers;
  analysis?: Analysis;
  /** Price a specialist confirmed, if any (cleared when the customer edits the order) */
  confirmedTotal?: number | null;
  /** A specialist has reviewed this shipment, so restricted-item flags are cleared */
  reviewedBySpecialist?: boolean;
}
