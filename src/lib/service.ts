// The questionnaire flow: assess answers -> AI fills the order -> customer edits
// (deterministic re-pricing) -> place order. Every step re-scores confidence
// and opens / updates / closes the human hand-off ticket.

import { analyze, aiEnabled, parseDataUrl } from "./analyze";
import { buildQuote } from "./quote";
import { CONFIDENCE_FLOOR, isSalesLead, scoreAnalysis } from "./confidence";
import { HARD_ESCALATION } from "./guidelines";
import { readLink, type LinkInfo } from "./link";
import { suggestPackaging } from "./packaging";
import { isAland, isFinnishPostcode } from "./catalog";
import {
  appendMessage,
  getConversation,
  listOrders,
  listTickets,
  newId,
  purgeExpired,
  recordEvent,
  saveOrder,
  saveTicket,
  upsertConversation,
} from "./store";
import type {
  Address,
  Analysis,
  Answers,
  Attachment,
  ConfidenceReport,
  Conversation,
  Order,
  PartName,
  QuoteResult,
  Selection,
  Shipment,
} from "./types";

export interface AssessResult {
  conversationId: string;
  mode: "ai" | "mock";
  shipment: Shipment;
  quote: QuoteResult | null;
  confidence: ConfidenceReport;
  note: string;
  packagingNote: string;
  ticketId: string | null;
  salesLead: boolean;
  confirmedTotal: number | null;
  /** Set when the demo confidence floor is on (see confidence.ts) */
  confidenceFloor: number | null;
}

const PART_WORDS: Record<PartName, string> = {
  understanding: "what you're shipping",
  recommendation: "the product choice",
  price: "the exact price",
  policy: "whether we can accept this item",
  answer: "your question",
};

const stated = <T,>(value: T, evidence = "Answered in the form") => ({
  value,
  confidence: 1,
  source: "customer_stated" as const,
  evidence,
});
const unknown = { value: null, confidence: 0, source: "unknown" as const, evidence: "" };

function profileFromAnswers(a: Answers): Shipment {
  const num = (n: number | null) => (n != null && n > 0 ? stated(n) : { ...unknown });
  return {
    origin_country: stated("Finland", "Domestic service"),
    destination_country: stated("Finland", "Domestic service"),
    contents: { ...unknown },
    weight_kg: num(a.weightKg),
    length_cm: num(a.lengthCm),
    width_cm: num(a.widthCm),
    height_cm: num(a.heightCm),
    declared_value_eur: num(a.valueEur),
    parcel_count: stated(Math.max(1, Math.round(a.parcels || 1))),
    urgency: stated(a.urgency),
    is_fragile: a.fragile === "yes",
    is_business: false,
  };
}

/** Customer-stated form answers always win over the model's extraction. */
function mergeStated(ai: Shipment, form: Shipment): Shipment {
  const out = structuredClone(ai);
  for (const k of Object.keys(form) as (keyof Shipment)[]) {
    const f = form[k];
    if (typeof f === "object" && f && "source" in f && f.source === "customer_stated" && f.value != null) {
      (out as Record<string, unknown>)[k] = f;
    }
  }
  if (form.is_fragile) out.is_fragile = true;
  return out;
}

function answersText(a: Answers): string {
  return [
    a.description && `Description: ${a.description}`,
    `Form answers: domestic shipment within Finland; speed preference: ${a.urgency}; already packed: ${a.alreadyPacked}; fragile: ${a.fragile}`,
    a.weightKg && `weight ${a.weightKg} kg`,
    a.lengthCm && a.widthCm && a.heightCm && `size ${a.lengthCm}x${a.widthCm}x${a.heightCm} cm`,
    a.valueEur && `value ${a.valueEur} EUR`,
    a.parcels > 1 && `${a.parcels} parcels`,
  ]
    .filter(Boolean)
    .join(". ");
}

/** Price + score + hand-off. Shared by assess and reprice. */
function evaluate(conv: Conversation, analysis: Analysis, shipment: Shipment, selection: Selection) {
  const packSuggestions = suggestPackaging(shipment, conv.answers?.alreadyPacked ?? "unsure");
  const priced = buildQuote({
    shipment,
    selection,
    aiPick: analysis.recommended_product_id,
    aiAddOnIds: analysis.suggested_add_on_ids,
    packagingSuggestions: packSuggestions,
  });
  // Once a specialist has reviewed the shipment, restricted-item flags are settled.
  const scored: Analysis = conv.reviewedBySpecialist
    ? { ...analysis, risk_flags: analysis.risk_flags.filter((f) => !HARD_ESCALATION[f.code] || f.code === "prohibited_item") }
    : analysis;
  const confidence = scoreAnalysis({ ...scored, intent: "quote" }, priced?.packed ?? shipment, priced?.quote ?? null);

  // Hand-off ticket
  const open = listTickets().find((t) => t.conversationId === conv.id && t.status === "open" && t.kind === "support");
  let ticketId: string | null = null;
  let handoff = "";
  if (confidence.decision === "delegate") {
    const parts = confidence.delegatedParts.map((p) => PART_WORDS[p]);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    handoff = `I'm not fully certain about ${list}, so a specialist is double-checking it.`;
    // Company-rule reasons first: they're why a human is needed.
    const reasons = confidence.parts
      .filter((p) => p.delegated)
      .sort((a, b) => Number(b.part === "policy") - Number(a.part === "policy"))
      .flatMap((p) => p.reasons.map((r) => `${p.label}: ${r}`));
    const t = open ?? {
      id: newId("tkt"),
      conversationId: conv.id,
      kind: "support" as const,
      status: "open" as const,
      createdAt: new Date().toISOString(),
      parts: [],
      reasons: [],
      aiDraft: "",
      quote: null,
      shipment: null,
      confidence: null,
    };
    saveTicket({ ...t, parts: confidence.delegatedParts, reasons, aiDraft: analysis.reply, quote: priced?.quote ?? null, shipment, confidence });
    ticketId = t.id;
  } else if (open && confidence.decision === "auto") {
    recordEvent("srv_ticket_auto_closed", {});
    saveTicket({
      ...open,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      resolution: "Customer corrected the details and the AI could price it confidently - no human needed.",
      agentName: "AI",
    });
  }

  const salesLead = isSalesLead(analysis);
  if (salesLead && !listTickets().some((t) => t.conversationId === conv.id && t.kind === "sales")) {
    saveTicket({
      id: newId("lead"),
      conversationId: conv.id,
      kind: "sales",
      status: "open",
      createdAt: new Date().toISOString(),
      parts: [],
      reasons: analysis.risk_flags.filter((f) => f.code === "volume_customer").map((f) => `Volume customer: ${f.detail}`),
      aiDraft: analysis.reply,
      quote: priced?.quote ?? null,
      shipment,
      confidence,
    });
  }

  return { quote: confidence.hardFlags.length ? null : (priced?.quote ?? null), confidence, ticketId, handoff, salesLead };
}

export async function assess(answers: Answers, imageDataUrl?: string, imageName?: string): Promise<AssessResult> {
  const image = imageDataUrl ? parseDataUrl(imageDataUrl) : null;
  if (imageDataUrl && !image) throw new UserError("Unsupported image type");
  // Postcodes are optional for now (domestic flat pricing); full addresses are taken at order time.
  if (!answers.description.trim() && !image && !answers.link.trim()) throw new UserError("Tell us what you're shipping");

  const started = Date.now();
  purgeExpired();
  const conv: Conversation = {
    id: newId("conv"),
    createdAt: new Date().toISOString(),
    messages: [],
    shipment: null,
    mode: aiEnabled() ? "ai" : "mock",
    answers,
  };
  upsertConversation(conv);

  const link: LinkInfo | null = answers.link.trim() ? await readLink(answers.link.trim()) : null;
  const attachments: Attachment[] = [];
  if (imageDataUrl) attachments.push({ kind: "image", name: imageName ?? "photo", dataUrl: imageDataUrl });
  if (link)
    attachments.push({
      kind: "link",
      name: link.title || link.url,
      url: link.url,
      summary: link.ok ? `${link.title ?? link.url}${link.structured ? " (product data found)" : ""}` : `could not read: ${link.error}`,
    });
  const text = answersText(answers);
  appendMessage(conv.id, { id: newId("m"), role: "customer", text, at: new Date().toISOString(), attachments });

  const form = profileFromAnswers(answers);
  const analysis = await analyze({ history: [], text, image, link, profile: form });
  addTerritoryFlag(analysis, [answers.fromPostcode, answers.toPostcode]);
  const shipment = mergeStated(analysis.shipment, form);

  const fresh = getConversation(conv.id)!;
  fresh.analysis = analysis;
  fresh.shipment = shipment;
  upsertConversation(fresh);

  const ev = evaluate(fresh, analysis, shipment, { productId: null, addOnIds: null, packagingIds: null });
  const note = [analysis.reply.trim(), ev.handoff].filter(Boolean).join("\n\n");
  recordEvent("srv_quote", {
    ms: Date.now() - started,
    decision: ev.confidence.decision,
    confidence: Math.round(ev.confidence.overall * 100) / 100,
    photo: Boolean(image),
    link: Boolean(link),
    linkOk: Boolean(link?.ok),
    mode: conv.mode,
    productId: ev.quote?.recommended?.productId ?? "none",
    packaging: ev.quote?.packaging.filter((p) => p.selected).length ?? 0,
    delegatedParts: ev.confidence.delegatedParts.length,
  });
  appendMessage(conv.id, {
    id: newId("m"),
    role: "assistant",
    text: note,
    at: new Date().toISOString(),
    quote: ev.quote,
    confidence: ev.confidence,
    ticketId: ev.ticketId,
  });

  return {
    conversationId: conv.id,
    mode: conv.mode,
    shipment,
    quote: ev.quote,
    confidence: ev.confidence,
    note,
    packagingNote: analysis.packaging_note,
    ticketId: ev.ticketId,
    salesLead: ev.salesLead,
    confirmedTotal: null,
    confidenceFloor: CONFIDENCE_FLOOR,
  };
}

export type Edits = Partial<{
  origin_country: string;
  destination_country: string;
  contents: string;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  declared_value_eur: number | null;
  parcel_count: number;
  urgency: "cheapest" | "balanced" | "fastest";
  is_fragile: boolean;
}>;

const FIELD_LABEL: Record<keyof Edits, string> = {
  origin_country: "from",
  destination_country: "to",
  contents: "contents",
  weight_kg: "weight (kg)",
  length_cm: "length (cm)",
  width_cm: "width (cm)",
  height_cm: "height (cm)",
  declared_value_eur: "value (EUR)",
  parcel_count: "parcels",
  urgency: "speed",
  is_fragile: "fragile",
};

/** Customer edited the form: apply edits as customer-stated facts and re-price. */
export async function reprice(conversationId: string, edits: Edits, selection: Selection): Promise<AssessResult> {
  const conv = getConversation(conversationId);
  if (!conv?.analysis || !conv.shipment) throw new UserError("Quote not found - please start again");
  let analysis = conv.analysis;
  const prevPackagingNote = conv.analysis.packaging_note;
  const prevContents = conv.shipment.contents.value;
  const s = structuredClone(conv.shipment);
  const changed: string[] = [];

  for (const [k, v] of Object.entries(edits) as [keyof Edits, unknown][]) {
    if (!(k in FIELD_LABEL)) continue;
    if (k === "is_fragile") {
      if (s.is_fragile !== v) changed.push(`fragile: ${v ? "yes" : "no"}`);
      s.is_fragile = Boolean(v);
      continue;
    }
    const field = s[k] as { value: unknown };
    const val = typeof v === "number" ? (v > 0 ? v : null) : typeof v === "string" ? v.trim() || null : null;
    if (field.value === val) continue;
    changed.push(`${FIELD_LABEL[k]}: ${val ?? "cleared"}`);
    (s as Record<string, unknown>)[k] = val == null ? { ...unknown } : stated(val, "Edited by customer");
  }

  if (changed.length) {
    // Pushed onto conv (not appendMessage) because conv is saved below and would overwrite it.
    conv.messages.push({ id: newId("m"), role: "customer", text: `Edited the order - ${changed.join(", ")}`, at: new Date().toISOString() });
    conv.confirmedTotal = null; // a confirmed price no longer applies
  }

  // New contents need a fresh look (restricted items, product fit). Earlier hard flags stay
  // until a specialist clears them, so editing the description can't dodge the rules.
  if (edits.contents != null && edits.contents.trim() && edits.contents.trim() !== conv.shipment.contents.value) {
    const next = await analyze({ history: conv.messages, text: `The customer corrected what they are shipping to: ${edits.contents}`, image: null, link: null, profile: s });
    const sticky = analysis.risk_flags.filter((f) => HARD_ESCALATION[f.code] && f.code !== "customer_requested_human");
    const codes = new Set(next.risk_flags.map((f) => f.code));
    analysis = { ...next, risk_flags: [...next.risk_flags, ...sticky.filter((f) => !codes.has(f.code))] };
    Object.assign(s, mergeStated(next.shipment, s));
  }

  conv.shipment = s;
  conv.analysis = analysis;
  upsertConversation(conv);

  const before = scoreOnly(conv);
  const ev = evaluate(conv, analysis, s, selection);
  recordEvent("srv_reprice", {
    fieldsChanged: changed.length,
    before,
    after: ev.confidence.decision,
    reanalyzed: Boolean(edits.contents?.trim() && edits.contents.trim() !== prevContents),
  });
  if (changed.length) {
    appendMessage(conv.id, {
      id: newId("m"),
      role: "assistant",
      text: ev.handoff || "Updated the quote with your changes.",
      at: new Date().toISOString(),
      quote: ev.quote,
      confidence: ev.confidence,
      ticketId: ev.ticketId,
    });
  }
  return {
    conversationId: conv.id,
    mode: conv.mode,
    shipment: s,
    quote: ev.quote,
    confidence: ev.confidence,
    note: ev.handoff || (changed.length ? `Updated your quote with your changes (${changed.join(", ")}).` : analysis.reply),
    packagingNote: analysis.packaging_note || prevPackagingNote,
    ticketId: ev.ticketId,
    salesLead: ev.salesLead,
    confirmedTotal: conv.confirmedTotal ?? null,
    confidenceFloor: CONFIDENCE_FLOOR,
  };
}

export class UserError extends Error {}

/** Åland is outside the EU VAT area: always a specialist case (deterministic, not left to the AI). */
function addTerritoryFlag(analysis: Analysis, postcodes: string[]): boolean {
  if (!postcodes.some((p) => isAland(p ?? ""))) return false;
  if (analysis.risk_flags.some((f) => f.code === "special_territory")) return false;
  analysis.risk_flags.push({ code: "special_territory", detail: "Åland Islands postcode" });
  return true;
}

function validAddress(a: Address | undefined, who: string): Address {
  if (!a) throw new UserError(`Please add the ${who}'s details`);
  for (const k of ["name", "street", "postcode", "city"] as const) {
    if (!a[k]?.trim()) throw new UserError(`Please fill in the ${who}'s ${k}`);
  }
  if (!isFinnishPostcode(a.postcode)) throw new UserError(`The ${who}'s postcode should be 5 digits - we ship within Finland only for now`);
  if (who === "sender" && !/^\S+@\S+\.\S+$/.test(a.email ?? "")) throw new UserError("Please add a valid email so we can send your label");
  return {
    name: a.name.trim().slice(0, 100),
    street: a.street.trim().slice(0, 200),
    postcode: a.postcode.trim().slice(0, 20),
    city: a.city.trim().slice(0, 100),
    email: (a.email ?? "").trim().slice(0, 200),
    phone: a.phone?.trim().slice(0, 40),
  };
}

/** Place the order. The price is always recomputed here - never trusted from the browser. */
export async function placeOrder(conversationId: string, selection: Selection, sender: Address, recipient: Address): Promise<Order> {
  const conv = getConversation(conversationId);
  if (!conv?.analysis || !conv.shipment) throw new UserError("Quote not found - please start again");
  if (conv.analysis.risk_flags.some((f) => f.code === "prohibited_item") && !conv.reviewedBySpecialist) {
    throw new UserError("We can't accept this item. A specialist has been notified and will contact you if there's an alternative.");
  }
  const from = validAddress(sender, "sender");
  const to = validAddress(recipient, "recipient");
  if (addTerritoryFlag(conv.analysis, [from.postcode, to.postcode])) {
    conv.reviewedBySpecialist = false;
    upsertConversation(conv);
  }
  const ev = evaluate(conv, conv.analysis, conv.shipment, selection);
  const q = ev.quote;
  const needsReview = ev.confidence.decision === "delegate";
  if (!q?.recommended && !needsReview) throw new UserError("No product fits these details - please adjust the order");

  const order: Order = {
    id: `NP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    conversationId: conv.id,
    createdAt: new Date().toISOString(),
    status: needsReview ? "pending_review" : "confirmed",
    productId: q?.recommended?.productId ?? "",
    productName: q?.recommended?.productName ?? "To be confirmed by specialist",
    shipment: conv.shipment,
    addOnIds: q?.addOns.filter((a) => a.selected).map((a) => a.id) ?? [],
    packagingIds: q?.packaging.filter((p) => p.selected).map((p) => p.id) ?? [],
    total: conv.confirmedTotal ?? q?.grandTotal ?? 0,
    sender: from,
    recipient: to,
    ticketId: ev.ticketId,
    note: needsReview ? "A specialist will confirm the final details before pickup." : undefined,
  };
  saveOrder(order);
  recordEvent("srv_order", {
    status: order.status,
    total: order.total,
    productId: order.productId || "none",
    packaging: order.packagingIds.length,
    addOns: order.addOnIds.length,
    msSinceQuote: Date.now() - new Date(conv.createdAt).getTime(),
  });
  appendMessage(conv.id, {
    id: newId("m"),
    role: "customer",
    text: `Placed order ${order.id} (${order.status === "confirmed" ? "confirmed" : "pending specialist review"}) - total €${order.total.toFixed(2)}`,
    at: order.createdAt,
  });
  return order;
}

/** Last decision shown for this conversation (for before/after analytics). */
function scoreOnly(conv: Conversation): "auto" | "ask_customer" | "delegate" {
  const last = [...conv.messages].reverse().find((m) => m.role === "assistant" && m.confidence);
  return last?.confidence?.decision ?? "auto";
}

/** Called when a specialist resolves a ticket. */
export function onSpecialistResolved(conversationId: string, confirmedTotal: number | null) {
  const conv = getConversation(conversationId);
  if (!conv) return;
  conv.reviewedBySpecialist = true;
  if (confirmedTotal != null) conv.confirmedTotal = confirmedTotal;
  upsertConversation(conv);
  if (confirmedTotal == null) return; // a reply without a confirmed price doesn't approve an order
  for (const o of listOrders().filter((o) => o.conversationId === conversationId && o.status === "pending_review")) {
    saveOrder({ ...o, status: "confirmed", total: confirmedTotal, note: "Confirmed by a specialist." });
  }
}
