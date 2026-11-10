// Turns raw analytics events into the success metrics shown on the dashboard.
//  - "srv_*" events: every quote/order, anonymous, no consent needed (service metrics)
//  - client events: only visitors who allowed statistics (behaviour, funnel, timing)

import type { AnalyticsEvent } from "./store";
import { STEP_NAMES, type StepName } from "./analytics-schema";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (a: number, b: number) => (b ? a / b : null);
const P = (e: AnalyticsEvent) => e.props as Record<string, number | boolean | string>;

export interface Metrics {
  generatedAt: string;
  rangeDays: number;
  service: {
    quotes: number;
    orders: number;
    conversion: number | null;
    revenue: number;
    avgOrderValue: number | null;
    packagingAttach: number | null;
    addOnAttach: number | null;
    aiAuto: number | null;
    aiAsk: number | null;
    aiDelegated: number | null;
    avgConfidence: number | null;
    medianAiMs: number | null;
    medianQuoteToOrderMs: number | null;
    photoShare: number | null;
    linkShare: number | null;
    linkReadSuccess: number | null;
    ticketsResolved: number;
    medianSpecialistWaitMs: number | null;
    ticketsAutoClosed: number;
    edits: number;
    editsRemovedHuman: number;
    pendingOrders: number;
    productMix: { id: string; quoted: number; ordered: number }[];
    daily: { day: string; quotes: number; orders: number }[];
  };
  behaviour: {
    sessions: number;
    funnel: { step: StepName; sessions: number }[];
    medianStepMs: { step: StepName; ms: number | null; n: number }[];
    medianTimeToQuoteMs: number | null;
    medianTimeToOrderMs: number | null;
    editClickRate: number | null;
    editToOrderRate: number | null;
    noEditToOrderRate: number | null;
    sessionConversion: number | null;
    photoPermissionRate: number | null;
    linkPermissionRate: number | null;
    photoAskCount: number;
    linkAskCount: number;
    abandonByStep: { step: StepName; count: number }[];
    orderErrors: { reason: string; count: number }[];
    quotesDeleted: number;
    medianSpecialistSeenMs: number | null;
  };
}

export function computeMetrics(all: AnalyticsEvent[], rangeDays = 30): Metrics {
  const since = Date.now() - rangeDays * 86_400_000;
  const ev = all.filter((e) => new Date(e.at).getTime() >= since);
  const of = (name: string) => ev.filter((e) => e.name === name);

  // ---------------- service (all traffic, anonymous)
  const q = of("srv_quote");
  const o = of("srv_order");
  const rp = of("srv_reprice");
  const tr = of("srv_ticket_resolved");
  const count = (xs: AnalyticsEvent[], f: (p: Record<string, number | boolean | string>) => boolean) => xs.filter((e) => f(P(e))).length;
  const revenue = o.reduce((t, e) => t + (P(e).total as number), 0);
  const linkQ = q.filter((e) => P(e).link);

  const productIds = ["letter-plus", "parcel-economy", "parcel-standard", "parcel-express", "freight-pallet"];
  const days: { day: string; quotes: number; orders: number }[] = [];
  for (let i = Math.min(rangeDays, 14) - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ day: d, quotes: q.filter((e) => e.at.startsWith(d)).length, orders: o.filter((e) => e.at.startsWith(d)).length });
  }

  // ---------------- behaviour (consented sessions only)
  const client = ev.filter((e) => e.sid);
  const sids = new Set(client.map((e) => e.sid!));
  const sidsWith = (name: string, f?: (p: Record<string, number | boolean | string>) => boolean) =>
    new Set(client.filter((e) => e.name === name && (!f || f(P(e)))).map((e) => e.sid!));
  const funnel = STEP_NAMES.map((step) => ({ step, sessions: sidsWith("step_view", (p) => p.step === step).size }));
  const quoted = sidsWith("quote_shown");
  const ordered = sidsWith("order_placed");
  const edited = sidsWith("edit_clicked");
  const editedQuoted = [...edited].filter((s) => quoted.has(s));
  const notEdited = [...quoted].filter((s) => !edited.has(s));
  const photoAsk = of("photo_permission").filter((e) => e.sid);
  const linkAsk = of("link_permission").filter((e) => e.sid);
  const errReasons = new Map<string, number>();
  for (const e of of("order_error")) errReasons.set(P(e).reason as string, (errReasons.get(P(e).reason as string) ?? 0) + 1);

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    service: {
      quotes: q.length,
      orders: o.length,
      conversion: ratio(o.length, q.length),
      revenue: Math.round(revenue * 100) / 100,
      avgOrderValue: o.length ? Math.round((revenue / o.length) * 100) / 100 : null,
      packagingAttach: ratio(count(o, (p) => (p.packaging as number) > 0), o.length),
      addOnAttach: ratio(count(o, (p) => (p.addOns as number) > 0), o.length),
      aiAuto: ratio(count(q, (p) => p.decision === "auto"), q.length),
      aiAsk: ratio(count(q, (p) => p.decision === "ask_customer"), q.length),
      aiDelegated: ratio(count(q, (p) => p.decision === "delegate"), q.length),
      avgConfidence: q.length ? q.reduce((t, e) => t + (P(e).confidence as number), 0) / q.length : null,
      medianAiMs: median(q.map((e) => P(e).ms as number)),
      medianQuoteToOrderMs: median(o.map((e) => P(e).msSinceQuote as number)),
      photoShare: ratio(count(q, (p) => p.photo === true), q.length),
      linkShare: ratio(linkQ.length, q.length),
      linkReadSuccess: ratio(count(linkQ, (p) => p.linkOk === true), linkQ.length),
      ticketsResolved: tr.length,
      medianSpecialistWaitMs: median(tr.map((e) => P(e).waitMs as number)),
      ticketsAutoClosed: of("srv_ticket_auto_closed").length,
      edits: rp.filter((e) => (P(e).fieldsChanged as number) > 0).length,
      editsRemovedHuman: count(rp, (p) => p.before === "delegate" && p.after !== "delegate"),
      pendingOrders: count(o, (p) => p.status === "pending_review"),
      productMix: productIds
        .map((id) => ({ id, quoted: count(q, (p) => p.productId === id), ordered: count(o, (p) => p.productId === id) }))
        .filter((x) => x.quoted || x.ordered),
      daily: days,
    },
    behaviour: {
      sessions: sids.size,
      funnel,
      medianStepMs: STEP_NAMES.filter((s) => s !== "done").map((step) => {
        const xs = of("step_done").filter((e) => e.sid && P(e).step === step).map((e) => P(e).ms as number);
        return { step, ms: median(xs), n: xs.length };
      }),
      medianTimeToQuoteMs: median(of("quote_shown").filter((e) => e.sid).map((e) => P(e).msSinceStart as number)),
      medianTimeToOrderMs: median(of("order_placed").filter((e) => e.sid).map((e) => P(e).msSinceStart as number)),
      editClickRate: ratio(editedQuoted.length, quoted.size),
      editToOrderRate: ratio(editedQuoted.filter((s) => ordered.has(s)).length, editedQuoted.length),
      noEditToOrderRate: ratio(notEdited.filter((s) => ordered.has(s)).length, notEdited.length),
      sessionConversion: ratio([...quoted].filter((s) => ordered.has(s)).length, quoted.size),
      photoPermissionRate: ratio(count(photoAsk, (p) => p.granted === true), photoAsk.length),
      linkPermissionRate: ratio(count(linkAsk, (p) => p.granted === true), linkAsk.length),
      photoAskCount: photoAsk.length,
      linkAskCount: linkAsk.length,
      abandonByStep: STEP_NAMES.filter((s) => s !== "done")
        .map((step) => ({ step, count: of("abandon").filter((e) => P(e).step === step).length }))
        .filter((x) => x.count),
      orderErrors: [...errReasons].map(([reason, c]) => ({ reason, count: c })),
      quotesDeleted: of("quote_deleted").length,
      medianSpecialistSeenMs: median(of("specialist_reply_seen").map((e) => P(e).waitMs as number)),
    },
  };
}
