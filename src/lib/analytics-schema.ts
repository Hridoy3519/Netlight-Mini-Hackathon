// The complete list of analytics events and their allowed properties.
// The server drops anything not listed here, so free text or personal data
// can never end up in analytics by accident.

export const STEP_NAMES = ["item", "extras", "speed", "details", "quote", "address", "done"] as const;
export type StepName = (typeof STEP_NAMES)[number];
type Decision = "auto" | "ask_customer" | "delegate";

export interface EventProps {
  // ----- client (only with statistics consent) -----
  session_start: { entry: "home" | "quote" | "other" };
  step_view: { step: StepName };
  step_done: { step: StepName; ms: number };
  photo_permission: { granted: boolean };
  link_permission: { granted: boolean };
  photo_added: Record<string, never>;
  link_added: Record<string, never>;
  quote_requested: { photo: boolean; link: boolean; description: boolean; weight: boolean; size: boolean };
  quote_shown: { msSinceStart: number; decision: Decision; confidence: number; delegatedParts: number; priceDelegated: boolean };
  edit_clicked: { from: "summary" | "section" };
  edit_saved: { fieldsChanged: number; selectionChanged: boolean; before: Decision; after: Decision };
  edit_cancelled: Record<string, never>;
  place_order_clicked: { decision: Decision };
  order_placed: { status: "confirmed" | "pending_review"; msSinceStart: number };
  order_error: { reason: "validation" | "prohibited" | "server" };
  specialist_reply_seen: { waitMs: number };
  quote_deleted: Record<string, never>;
  abandon: { step: StepName; msSinceStart: number };
  // ----- server (anonymous, no session id, no personal data) -----
  srv_quote: { ms: number; decision: Decision; confidence: number; photo: boolean; link: boolean; linkOk: boolean; mode: "ai" | "mock"; productId: string; packaging: number; delegatedParts: number };
  srv_reprice: { fieldsChanged: number; before: Decision; after: Decision; reanalyzed: boolean };
  srv_order: { status: "confirmed" | "pending_review"; total: number; productId: string; packaging: number; addOns: number; msSinceQuote: number };
  srv_ticket_resolved: { waitMs: number; withPrice: boolean };
  srv_ticket_auto_closed: Record<string, never>;
}
export type EventName = keyof EventProps;

type Rule = "number" | "boolean" | readonly string[];
const D = ["auto", "ask_customer", "delegate"] as const;
const S = STEP_NAMES;

export const EVENT_RULES: { [N in EventName]: { [K in keyof EventProps[N]]-?: Rule } } = {
  session_start: { entry: ["home", "quote", "other"] },
  step_view: { step: S },
  step_done: { step: S, ms: "number" },
  photo_permission: { granted: "boolean" },
  link_permission: { granted: "boolean" },
  photo_added: {},
  link_added: {},
  quote_requested: { photo: "boolean", link: "boolean", description: "boolean", weight: "boolean", size: "boolean" },
  quote_shown: { msSinceStart: "number", decision: D, confidence: "number", delegatedParts: "number", priceDelegated: "boolean" },
  edit_clicked: { from: ["summary", "section"] },
  edit_saved: { fieldsChanged: "number", selectionChanged: "boolean", before: D, after: D },
  edit_cancelled: {},
  place_order_clicked: { decision: D },
  order_placed: { status: ["confirmed", "pending_review"], msSinceStart: "number" },
  order_error: { reason: ["validation", "prohibited", "server"] },
  specialist_reply_seen: { waitMs: "number" },
  quote_deleted: {},
  abandon: { step: S, msSinceStart: "number" },
  srv_quote: { ms: "number", decision: D, confidence: "number", photo: "boolean", link: "boolean", linkOk: "boolean", mode: ["ai", "mock"], productId: ["letter-plus", "parcel-economy", "parcel-standard", "parcel-express", "freight-pallet", "none"], packaging: "number", delegatedParts: "number" },
  srv_reprice: { fieldsChanged: "number", before: D, after: D, reanalyzed: "boolean" },
  srv_order: { status: ["confirmed", "pending_review"], total: "number", productId: ["letter-plus", "parcel-economy", "parcel-standard", "parcel-express", "freight-pallet", "none"], packaging: "number", addOns: "number", msSinceQuote: "number" },
  srv_ticket_resolved: { waitMs: "number", withPrice: "boolean" },
  srv_ticket_auto_closed: {},
};

export const CLIENT_EVENTS = (Object.keys(EVENT_RULES) as EventName[]).filter((n) => !n.startsWith("srv_"));

/** Returns sanitised props, or null if the event is not allowed. */
export function sanitize(name: string, props: unknown): Record<string, number | boolean | string> | null {
  const rules = (EVENT_RULES as Record<string, Record<string, Rule>>)[name];
  if (!rules) return null;
  const input = (props && typeof props === "object" ? props : {}) as Record<string, unknown>;
  const out: Record<string, number | boolean | string> = {};
  for (const [k, rule] of Object.entries(rules)) {
    const v = input[k];
    if (rule === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      out[k] = Math.round(v * 1000) / 1000;
    } else if (rule === "boolean") {
      if (typeof v !== "boolean") return null;
      out[k] = v;
    } else {
      if (typeof v !== "string" || !rule.includes(v)) return null;
      out[k] = v;
    }
  }
  return out;
}
