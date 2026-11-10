// Tiny JSON-file store so conversations and tickets survive dev-server reloads.
// Replace with a real database for production.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ChatMessage, Conversation, Order, Ticket } from "./types";
import { sanitize, type EventName } from "./analytics-schema";

export interface AnalyticsEvent {
  at: string;
  sid: string | null; // anonymous per-visit id (client events only)
  name: EventName;
  props: Record<string, number | boolean | string>;
  /** Synthetic traffic generated for demos - excluded with one click */
  demo?: boolean;
}

/** Retention periods (GDPR storage limitation). */
export const RETENTION = {
  quoteDays: 30, // quotes that never became orders, incl. photos
  photoDays: 30, // photos are stripped from orders after this
  eventDays: 395, // anonymous analytics (13 months)
};

interface DB {
  conversations: Record<string, Conversation>;
  tickets: Record<string, Ticket>;
  orders: Record<string, Order>;
  events: AnalyticsEvent[];
}

const FILE = path.join(process.cwd(), ".data", "store.json");

function load(): DB {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, "utf8")) as DB;
    db.orders ??= {};
    db.events ??= [];
    return db;
  } catch {
    return { conversations: {}, tickets: {}, orders: {}, events: [] };
  }
}

function save(db: DB) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

// Long random ids: conversation ids act as the customer's access key to their own quote.
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;

export function getConversation(id: string): Conversation | null {
  return load().conversations[id] ?? null;
}

export function upsertConversation(c: Conversation) {
  const db = load();
  db.conversations[c.id] = c;
  save(db);
}

export function appendMessage(conversationId: string, m: ChatMessage) {
  const db = load();
  const c = db.conversations[conversationId];
  if (!c) throw new Error("conversation not found");
  c.messages.push(m);
  save(db);
}

export function listTickets(): Ticket[] {
  return Object.values(load().tickets).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTicket(id: string): Ticket | null {
  return load().tickets[id] ?? null;
}

export function saveTicket(t: Ticket) {
  const db = load();
  db.tickets[t.id] = t;
  save(db);
}

export function listOrders(): Order[] {
  return Object.values(load().orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveOrder(o: Order) {
  const db = load();
  db.orders[o.id] = o;
  save(db);
}

export function stats() {
  const db = load();
  const msgs = Object.values(db.conversations).flatMap((c) => c.messages.filter((m) => m.role === "assistant"));
  const tickets = Object.values(db.tickets);
  return {
    conversations: Object.keys(db.conversations).length,
    aiReplies: msgs.length,
    autoResolved: msgs.filter((m) => m.confidence?.decision === "auto").length,
    askedCustomer: msgs.filter((m) => m.confidence?.decision === "ask_customer").length,
    delegated: msgs.filter((m) => m.confidence?.decision === "delegate").length,
    openTickets: tickets.filter((t) => t.status === "open").length,
    salesLeads: tickets.filter((t) => t.kind === "sales").length,
    quotesGiven: msgs.filter((m) => m.quote?.recommended).length,
    ordersPlaced: Object.keys(db.orders).length,
    ordersConfirmed: Object.values(db.orders).filter((o) => o.status === "confirmed").length,
  };
}

// ---------------------------------------------------------------------------
// Analytics

export function recordEvent(name: string, props: unknown, sid: string | null = null): boolean {
  const clean = sanitize(name, props);
  if (!clean) return false;
  const db = load();
  db.events.push({ at: new Date().toISOString(), sid, name: name as EventName, props: clean });
  if (db.events.length > 50_000) db.events.splice(0, db.events.length - 50_000);
  save(db);
  return true;
}

export function listEvents(): AnalyticsEvent[] {
  return load().events;
}

export function allData() {
  const db = load();
  return { conversations: Object.values(db.conversations), tickets: Object.values(db.tickets), orders: Object.values(db.orders), events: db.events };
}

// ---------------------------------------------------------------------------
// GDPR: retention and data-subject rights

const daysAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

/** Deletes data past its retention period. Cheap enough to run on each new quote. */
export function purgeExpired() {
  const db = load();
  let changed = false;
  const withOrders = new Set(Object.values(db.orders).map((o) => o.conversationId));
  for (const c of Object.values(db.conversations)) {
    const age = daysAgo(c.createdAt);
    if (!withOrders.has(c.id) && age > RETENTION.quoteDays) {
      delete db.conversations[c.id];
      for (const t of Object.values(db.tickets)) if (t.conversationId === c.id) delete db.tickets[t.id];
      changed = true;
    } else if (age > RETENTION.photoDays) {
      for (const m of c.messages) {
        for (const a of m.attachments ?? []) {
          if (a.dataUrl) {
            delete a.dataUrl;
            a.summary = "photo deleted after retention period";
            changed = true;
          }
        }
      }
    }
  }
  const before = db.events.length;
  db.events = db.events.filter((e) => daysAgo(e.at) <= RETENTION.eventDays);
  if (changed || db.events.length !== before) save(db);
}

/** Right of access / portability: everything we hold about one order. */
export function exportOrderData(orderId: string, email: string) {
  const db = load();
  const o = db.orders[orderId];
  if (!o || o.sender.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  const c = db.conversations[o.conversationId];
  return {
    exportedAt: new Date().toISOString(),
    order: o,
    quote: c
      ? {
          createdAt: c.createdAt,
          answers: c.answers,
          messages: c.messages.map((m) => ({ role: m.role, at: m.at, text: m.text, attachments: m.attachments?.map((a) => ({ kind: a.kind, name: a.name, url: a.url, hasPhoto: Boolean(a.dataUrl) })) })),
        }
      : null,
  };
}

/** Right to erasure. Order records needed for bookkeeping (Finnish Accounting Act) keep only non-personal fields. */
export function eraseOrderData(orderId: string, email: string): boolean {
  const db = load();
  const o = db.orders[orderId];
  if (!o || o.sender.email.toLowerCase() !== email.trim().toLowerCase()) return false;
  eraseConversation(db, o.conversationId);
  const redacted = { name: "[erased]", street: "[erased]", postcode: o.sender.postcode.slice(0, 2) + "xxx", city: "[erased]", email: "[erased]" };
  db.orders[orderId] = {
    ...o,
    sender: redacted,
    recipient: { ...redacted, postcode: o.recipient.postcode.slice(0, 2) + "xxx" },
    shipment: { ...o.shipment, contents: { ...o.shipment.contents, value: "[erased]", evidence: "" } },
    note: "Personal data erased on request. Financial record kept as required by the Finnish Accounting Act.",
  };
  save(db);
  return true;
}

/** A visitor deletes a quote they didn't order (they hold its random id). */
export function eraseQuote(conversationId: string): "deleted" | "has_order" | "not_found" {
  const db = load();
  if (!db.conversations[conversationId]) return "not_found";
  if (Object.values(db.orders).some((o) => o.conversationId === conversationId)) return "has_order";
  eraseConversation(db, conversationId);
  save(db);
  return "deleted";
}

function eraseConversation(db: DB, id: string) {
  delete db.conversations[id];
  for (const t of Object.values(db.tickets)) if (t.conversationId === id) delete db.tickets[t.id];
}

export function addDemoEvents(events: { at: string; sid: string | null; name: string; props: unknown }[]): number {
  const db = load();
  let n = 0;
  for (const e of events) {
    const clean = sanitize(e.name, e.props);
    if (!clean) continue;
    db.events.push({ at: e.at, sid: e.sid, name: e.name as EventName, props: clean, demo: true });
    n++;
  }
  db.events.sort((a, b) => a.at.localeCompare(b.at));
  save(db);
  return n;
}

export function clearDemoEvents(): number {
  const db = load();
  const before = db.events.length;
  db.events = db.events.filter((e) => !e.demo);
  save(db);
  return before - db.events.length;
}
