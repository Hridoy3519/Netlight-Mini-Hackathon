// Synthetic visitor traffic so the dashboard can be demoed before real users exist.
// Everything generated here is flagged `demo` and can be cleared from the dashboard.

import crypto from "node:crypto";
import type { StepName } from "./analytics-schema";

type E = { at: string; sid: string | null; name: string; props: unknown };

export function generateDemoTraffic(sessions = 160, days = 14): E[] {
  const out: E[] = [];
  const rnd = Math.random;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const products = ["parcel-economy", "parcel-standard", "parcel-standard", "parcel-express", "letter-plus"];

  for (let i = 0; i < sessions; i++) {
    let t = Date.now() - rnd() * days * 86_400_000;
    const consented = rnd() < 0.62; // share of visitors who allow statistics
    const sid = consented ? crypto.randomUUID() : null;
    const start = t;
    const push = (name: string, props: unknown, client = true) => {
      if (client && !sid) return;
      out.push({ at: new Date(t).toISOString(), sid: client ? sid : null, name, props });
    };
    const step = (s: StepName, meanSec: number, dropout: number) => {
      push("step_view", { step: s });
      const ms = Math.max(1500, meanSec * 1000 * (0.4 + rnd() * 1.4));
      t += ms;
      if (rnd() < dropout) {
        push("abandon", { step: s, msSinceStart: t - start });
        return false;
      }
      push("step_done", { step: s, ms });
      return true;
    };

    push("session_start", { entry: rnd() < 0.7 ? "home" : "other" });
    if (!step("item", 14, 0.12)) continue;
    const wantsPhoto = rnd() < 0.35;
    const wantsLink = !wantsPhoto && rnd() < 0.3;
    if (wantsPhoto) {
      const ok = rnd() < 0.78;
      push("photo_permission", { granted: ok });
      if (ok) push("photo_added", {});
    }
    if (wantsLink) {
      const ok = rnd() < 0.9;
      push("link_permission", { granted: ok });
      if (ok) push("link_added", {});
    }
    if (!step("extras", 12, 0.06)) continue;
    if (!step("speed", 5, 0.02)) continue;
    if (!step("details", 22, 0.08)) continue;

    const photo = wantsPhoto && rnd() < 0.78;
    const link = wantsLink;
    // With the demo confidence floor on, only company rules (restricted goods) reach a human.
    const floor = Number(process.env.CONFIDENCE_FLOOR) || 0;
    const decision = floor ? (rnd() < 0.06 ? "delegate" : "auto") : photo ? (rnd() < 0.55 ? "delegate" : "auto") : rnd() < 0.82 ? "auto" : "delegate";
    const raw = decision === "auto" ? 0.8 + rnd() * 0.18 : 0.4 + rnd() * 0.18;
    const conf = floor ? floor + raw * (1 - floor) : raw;
    const aiMs = 2500 + rnd() * 4500;
    const product = pick(products);
    t += aiMs;
    push("quote_requested", { photo, link, description: true, weight: rnd() < 0.5, size: rnd() < 0.35 });
    push("srv_quote", { ms: aiMs, decision, confidence: Math.round(conf * 100) / 100, photo, link, linkOk: link && rnd() < 0.85, mode: "ai", productId: product, packaging: rnd() < 0.55 ? 1 + Math.floor(rnd() * 2) : 0, delegatedParts: decision === "delegate" ? 1 + Math.floor(rnd() * 2) : 0 }, false);
    push("quote_shown", { msSinceStart: t - start, decision, confidence: Math.round(conf * 100) / 100, delegatedParts: decision === "delegate" ? 1 : 0, priceDelegated: decision === "delegate" });
    push("step_view", { step: "quote" });

    let finalDecision = decision;
    const edits = rnd() < (decision === "delegate" ? 0.6 : 0.25);
    if (edits) {
      t += 15000 + rnd() * 40000;
      push("edit_clicked", { from: rnd() < 0.6 ? "summary" : "section" });
      if (rnd() < 0.85) {
        finalDecision = decision === "delegate" && rnd() < 0.7 ? "auto" : decision;
        push("edit_saved", { fieldsChanged: 1 + Math.floor(rnd() * 3), selectionChanged: rnd() < 0.4, before: decision, after: finalDecision });
        push("srv_reprice", { fieldsChanged: 2, before: decision, after: finalDecision, reanalyzed: rnd() < 0.2 }, false);
        if (decision === "delegate" && finalDecision === "auto") push("srv_ticket_auto_closed", {}, false);
      } else push("edit_cancelled", {});
    }
    if (finalDecision === "delegate" && rnd() < 0.7) {
      const wait = 60_000 + rnd() * 360_000;
      push("srv_ticket_resolved", { waitMs: wait, withPrice: true }, false);
      push("specialist_reply_seen", { waitMs: wait });
    }
    const orderP = finalDecision === "auto" ? (edits ? 0.62 : 0.48) : 0.3;
    if (rnd() > orderP) {
      t += 20000 + rnd() * 60000;
      push("abandon", { step: "quote", msSinceStart: t - start });
      continue;
    }
    t += 10000 + rnd() * 30000;
    push("place_order_clicked", { decision: finalDecision });
    push("step_view", { step: "address" });
    t += 40000 + rnd() * 50000;
    push("step_done", { step: "address", ms: 40000 + rnd() * 50000 });
    if (rnd() < 0.08) push("order_error", { reason: "validation" });
    if (rnd() < 0.07) {
      push("abandon", { step: "address", msSinceStart: t - start });
      continue;
    }
    const status = finalDecision === "delegate" ? "pending_review" : "confirmed";
    const total = 9 + rnd() * 70;
    push("srv_order", { status, total: Math.round(total * 100) / 100, productId: product, packaging: rnd() < 0.5 ? 1 : 0, addOns: rnd() < 0.3 ? 1 : 0, msSinceQuote: t - start }, false);
    push("order_placed", { status, msSinceStart: t - start });
    push("step_view", { step: "done" });
  }
  return out;
}
