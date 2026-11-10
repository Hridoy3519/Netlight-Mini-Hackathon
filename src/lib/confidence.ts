// Confidence engine.
//
// LLM self-reported confidence alone is not trustworthy, so each part of the
// answer is scored from several independent signals:
//   1. Where each fact came from (customer said it > product page > photo guess)
//   2. The model's own per-field and per-answer confidence
//   3. Deterministic cross-checks (does a simple rule pick the same product?
//      would the price change a lot if the weight estimate is off?)
//   4. Hard guideline rules (restricted goods always go to a human)
// Any part that scores below the threshold is delegated to a human on its own,
// while the confident parts are answered instantly.

import { HARD_ESCALATION, SALES_FLAGS } from "./guidelines";
import { PRODUCTS } from "./catalog";
import { rulePick, chargeableWeight } from "./quote";
import type {
  Analysis,
  ConfidenceReport,
  Level,
  PartName,
  PartScore,
  QuoteResult,
  Shipment,
  Source,
} from "./types";

export const DELEGATE_BELOW = 0.6;

/**
 * DEMO SETTING. When set (e.g. CONFIDENCE_FLOOR=0.95), every score is rescaled into
 * [floor, 1] so the AI always shows high confidence, and nothing is delegated for low
 * confidence. Company rules (restricted goods, Åland) still go to a human.
 * Remove the env var to get the real, honest scores back.
 */
export const CONFIDENCE_FLOOR: number | null = (() => {
  const v = Number(process.env.CONFIDENCE_FLOOR);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : null;
})();
const lift = (x: number) => (CONFIDENCE_FLOOR == null ? x : CONFIDENCE_FLOOR + x * (1 - CONFIDENCE_FLOOR));
export const HIGH_FROM = 0.8;

/** Maximum confidence a value can have given where it came from. */
const SOURCE_CAP: Record<Source, number> = {
  customer_stated: 1,
  product_page: 0.9,
  page_text: 0.75,
  inferred: 0.7,
  image_estimate: 0.5,
  unknown: 0,
};

type Field = { value: unknown; confidence: number; source: Source };

export function calibrated(f: Field): number {
  if (f.value == null || f.value === "") return 0;
  return clamp(Math.min(f.confidence, SOURCE_CAP[f.source]));
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const level = (s: number): Level => (s >= HIGH_FROM ? "high" : s >= DELEGATE_BELOW ? "medium" : "low");
const pct = (n: number) => `${Math.round(n * 100)}%`;

const SOURCE_LABEL: Record<Source, string> = {
  customer_stated: "stated by customer",
  product_page: "from product page",
  page_text: "read from web page text",
  image_estimate: "estimated from photo",
  inferred: "inferred",
  unknown: "unknown",
};

function describe(name: string, f: Field): string {
  if (f.value == null) return `${name}: missing`;
  return `${name}: ${String(f.value)} (${SOURCE_LABEL[f.source]}, ${pct(calibrated(f))})`;
}

export function scoreAnalysis(a: Analysis, s: Shipment, quote: QuoteResult | null): ConfidenceReport {
  const parts: PartScore[] = [];
  const hardFlags = a.risk_flags
    .filter((f) => HARD_ESCALATION[f.code])
    .map((f) => `${HARD_ESCALATION[f.code]}${f.detail ? ` - ${f.detail}` : ""}`);
  const isQuote = a.intent === "quote";

  if (!isQuote) {
    const sc = clamp(a.answer_confidence);
    parts.push({
      part: "answer",
      label: "Answer",
      score: sc,
      level: level(sc),
      reasons: [
        `Model confidence in answer: ${pct(sc)}`,
        ...(a.uncertainty_notes ? [`Unsure about: ${a.uncertainty_notes}`] : []),
      ],
      delegated: false,
    });
  } else {
    // 1. Understanding the need
    const req: [string, Field, number][] = [
      ["Origin", s.origin_country, 0.5],
      ["Destination", s.destination_country, 1],
      ["Contents", s.contents, 1],
      ["Weight", s.weight_kg, 1],
    ];
    const wsum = req.reduce((t, [, , w]) => t + w, 0);
    const und = req.reduce((t, [, f, w]) => t + calibrated(f) * w, 0) / wsum;
    parts.push({
      part: "understanding",
      label: "Understanding your needs",
      score: und,
      level: level(und),
      reasons: req.map(([n, f]) => describe(n, f)),
      delegated: false,
    });

    // 2. Product recommendation
    const recReasons: string[] = [];
    let rec = Math.min(
      0.5 + 0.5 * calibrated(s.contents),
      a.answer_confidence,
      quote?.recommended ? 1 : 0.2,
    );
    if (!quote?.recommended) recReasons.push("No product fits the details we have");
    const rule = rulePick(s);
    if (quote?.recommended && rule && rule !== quote.recommended.productId) {
      rec -= 0.15;
      recReasons.push(
        `AI picked ${quote.recommended.productName}, rule-based check picked ${PRODUCTS.find((p) => p.id === rule)?.name}`,
      );
    } else if (quote?.recommended) {
      recReasons.push("AI and rule-based check agree on the product");
    }
    if (quote?.recommended?.range) {
      const p = PRODUCTS.find((x) => x.id === quote.recommended!.productId)!;
      const cw = chargeableWeight(s) ?? 0;
      const highCw = cw * (1 + (1 - calibrated(s.weight_kg)) * 0.6);
      if (highCw > p.maxWeightKg) {
        rec -= 0.3;
        recReasons.push(`Weight could exceed the ${p.maxWeightKg} kg limit of ${p.name}`);
      }
    }
    if (s.urgency.value == null) recReasons.push("Speed preference not stated - assumed balanced");
    rec = clamp(rec);
    parts.push({ part: "recommendation", label: "Product recommendation", score: rec, level: level(rec), reasons: recReasons, delegated: false });

    // 3. Price
    const priceReasons: string[] = [];
    let price = 0;
    if (quote?.recommended) {
      const wc = calibrated(s.weight_kg);
      price = wc;
      priceReasons.push(describe("Weight", s.weight_kg));
      const dims = [s.length_cm, s.width_cm, s.height_cm];
      if (dims.some((d) => d.value != null)) {
        const dc = Math.min(...dims.map(calibrated));
        price = Math.min(price, Math.max(dc, 0.3));
        priceReasons.push(`Dimensions: ${dims.map((d) => d.value ?? "?").join(" x ")} cm (${pct(dc)})`);
      } else {
        priceReasons.push("No dimensions - volumetric weight not checked");
        price = Math.min(price, 0.85);
      }
      const r = quote.recommended.range;
      if (r) {
        const spread = (r.high - r.low) / quote.recommended.totalIncVat;
        if (spread > 0.04) priceReasons.push(`Price could range €${r.low.toFixed(2)}-€${r.high.toFixed(2)} (±${pct(spread / 2)})`);
        if (spread > 0.3) price = Math.min(price, 0.5);
      }
    } else {
      priceReasons.push("Not enough details to price yet");
    }
    price = clamp(price);
    parts.push({ part: "price", label: "Price quote", score: price, level: level(price), reasons: priceReasons, delegated: false });
  }

  // 4. Policy / guidelines
  const soft = a.risk_flags.filter((f) => !HARD_ESCALATION[f.code] && !SALES_FLAGS.includes(f.code));
  const policy = hardFlags.length ? 0 : clamp(1 - soft.length * 0.05);
  parts.push({
    part: "policy",
    label: "Guideline check",
    score: policy,
    level: level(policy),
    reasons: hardFlags.length
      ? hardFlags
      : soft.length
        ? soft.map((f) => `${f.code}: ${f.detail}`)
        : ["No restricted or prohibited items detected"],
    delegated: false,
  });

  if (CONFIDENCE_FLOOR != null) {
    for (const p of parts) {
      p.score = lift(p.score);
      p.level = level(p.score);
    }
  }

  // Decision
  const missingCustomerInfo =
    isQuote &&
    (s.destination_country.value == null || s.contents.value == null || (s.weight_kg.value == null && s.length_cm.value == null));

  const delegated: PartName[] = [];
  for (const p of parts) {
    if (p.part === "understanding" && missingCustomerInfo) continue; // ask the customer instead
    if (p.part === "price" && missingCustomerInfo) continue;
    if (p.part === "recommendation" && missingCustomerInfo) continue;
    if (p.score < DELEGATE_BELOW) {
      p.delegated = true;
      delegated.push(p.part);
    }
  }
  // Company rules always need a human, whatever the confidence score says.
  if (hardFlags.length) {
    const pol = parts.find((p) => p.part === "policy")!;
    if (!pol.delegated) {
      pol.delegated = true;
      delegated.push("policy");
    }
  }
  // A restricted item invalidates the quote too.
  if (hardFlags.length) {
    for (const p of parts) {
      if ((p.part === "price" || p.part === "recommendation") && !p.delegated && !missingCustomerInfo) {
        p.delegated = true;
        delegated.push(p.part);
      }
    }
  }

  const scores = parts.map((p) => p.score);
  const overall = clamp(0.5 * Math.min(...scores) + 0.5 * (scores.reduce((a, b) => a + b, 0) / scores.length));

  return {
    overall,
    level: level(overall),
    parts,
    decision: delegated.length ? "delegate" : missingCustomerInfo ? "ask_customer" : "auto",
    delegatedParts: delegated,
    hardFlags,
  };
}

export function isSalesLead(a: Analysis): boolean {
  return a.risk_flags.some((f) => SALES_FLAGS.includes(f.code));
}
