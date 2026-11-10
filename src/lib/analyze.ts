import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GUIDELINES, RiskCode } from "./guidelines";
import { HOME_COUNTRY, catalogForPrompt } from "./catalog";
import { AnalysisSchema, type Analysis, type ChatMessage, type Shipment } from "./types";
import type { LinkInfo } from "./link";
import { linkInfoForPrompt } from "./link";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.ANTHROPIC_EFFORT ?? "low") as "low" | "medium" | "high";

export const aiEnabled = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.MOCK_AI !== "1";

const SYSTEM = `You are the AI customer service assistant for Nopea, a parcel and freight company.
Your job: understand what the customer wants to ship, recommend the right product, and let our pricing
system produce an instant quote - while following the company guidelines exactly.

${GUIDELINES}

${catalogForPrompt()}

How to work:
- Customers may describe their shipment in words, share a link to a product page, or upload a photo.
- Fill the shipment profile. For every field give value, confidence (0.0-1.0), source and evidence.
  * source=customer_stated only if the customer literally said it.
  * source=product_page for structured product data from a link; page_text for free text on the page.
  * source=image_estimate for anything you estimate from a photo (weight, size, contents). Be honest:
    photo-based weights and sizes are rough guesses, so keep their confidence modest.
  * source=inferred for reasonable assumptions. Origin and destination are always ${HOME_COUNTRY} (domestic only).
  * If you don't know, value=null, source=unknown, confidence=0. Never invent numbers to look complete.
- Product pages usually list the item's own weight/size. Estimate the packed parcel (add packaging, typically
  +10-20% weight and a few cm per side) and lower confidence accordingly; say so in evidence.
- Carry forward everything from the "current shipment profile" unless the customer changes it. Fields with
  source customer_stated came from the customer's form answers - keep them exactly.
- packaging_note: practical advice on how to pack this specific item (protection, box vs envelope, what to
  avoid). Our system picks the exact packaging products; you explain why in one or two sentences.
- If the customer mentions sending abroad, raise out_of_scope and kindly explain we only ship within Finland for now.
- Raise risk_flags for anything in the guidelines (restricted/prohibited items, fragile, high value,
  50+ parcels/month -> volume_customer, complaints, or the customer asking for a human).
- Pick recommended_product_id from the catalog that best fits their needs, or null if unclear.
- missing_info_question: ask for at most ONE thing only the customer can know (destination, what it is,
  rough weight) when it's missing. Don't ask for things you can reasonably estimate.
- reply: talk to the customer directly. Summarise what you understood, recommend the product and why,
  and if relevant suggest one useful add-on. NEVER write prices or cost numbers - the quote card is shown
  under your message automatically. If something is uncertain, say what and why in plain words.
- answer_confidence: your honest confidence that the reply is correct, complete and within guidelines.
  Lower it when you rely on estimates or the request is outside what the catalog covers.`;

type Img = { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };

export function parseDataUrl(dataUrl: string): Img | null {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  return m ? { media_type: m[1] as Img["media_type"], data: m[2] } : null;
}

let client: Anthropic | null = null;

export async function analyze(input: {
  history: ChatMessage[];
  text: string;
  image: Img | null;
  link: LinkInfo | null;
  profile: Shipment | null;
}): Promise<Analysis> {
  if (!aiEnabled()) return mockAnalyze(input);
  client ??= new Anthropic();

  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of input.history.slice(-16)) {
    if (m.role === "system") continue;
    const role = m.role === "customer" ? "user" : "assistant";
    const prefix = m.role === "human" ? `[Human colleague ${m.agentName ?? ""}]: ` : "";
    const att = m.attachments?.map((a) => `[${a.kind === "image" ? "photo" : "link"}: ${a.summary ?? a.name}]`).join(" ") ?? "";
    messages.push({ role, content: `${prefix}${m.text}${att ? `\n${att}` : ""}` || "(no text)" });
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", ...input.image } });
  if (input.link) content.push({ type: "text", text: linkInfoForPrompt(input.link) });
  content.push({
    type: "text",
    text: `Current shipment profile (from earlier in the conversation): ${input.profile ? JSON.stringify(input.profile) : "none yet"}`,
  });
  content.push({ type: "text", text: `Customer message: ${input.text || "(no text - see attachment)"}` });
  messages.push({ role: "user", content });

  let res;
  try {
    res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: EFFORT, format: betaZodOutputFormat(AnalysisSchema) },
    messages,
    });
  } catch (e) {
    // Bad key or no network (e.g. venue wifi): keep the demo alive with the offline analyzer.
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.APIConnectionError) {
      console.warn(`Claude unavailable (${e.constructor.name}) - using offline analyzer`);
      return mockAnalyze(input);
    }
    throw e;
  }

  if (res.stop_reason === "refusal" || !res.parsed_output) {
    return refusalAnalysis(input.profile);
  }
  return res.parsed_output;
}

function refusalAnalysis(profile: Shipment | null): Analysis {
  const base = mockAnalyze({ history: [], text: "", image: null, link: null, profile });
  return {
    ...base,
    intent: "other",
    answer_confidence: 0,
    uncertainty_notes: "The AI could not answer this request",
    reply: "I'm not able to help with that one myself, so I've passed it to a colleague.",
  };
}

// ---------------------------------------------------------------------------
// Mock analyzer: keyword/regex based, used when no API key is configured so the
// whole flow (and the confidence/hand-off logic) can be demoed offline.
// ---------------------------------------------------------------------------

const COUNTRIES = [
  "norway", "sweden", "denmark", "finland", "iceland", "germany", "france", "spain", "italy", "netherlands",
  "poland", "united kingdom", "uk", "ireland", "portugal", "austria", "belgium", "switzerland", "usa",
  "united states", "canada", "japan", "china", "australia", "india", "brazil",
];
const cap = (s: string) => (s === "uk" ? "United Kingdom" : s === "usa" ? "United States" : s.replace(/\b\w/g, (c) => c.toUpperCase()));

const TYPICAL: [RegExp, number, [number, number, number]][] = [
  [/chair|stool/, 6, [50, 50, 90]],
  [/laptop|notebook computer/, 2.2, [36, 25, 3]],
  [/vase/, 2, [20, 20, 35]],
  [/books?/, 4, [30, 22, 15]],
  [/shoes|sneakers|boots/, 1.3, [34, 22, 13]],
  [/lamp/, 3, [30, 30, 55]],
  [/monitor|tv|television/, 6, [70, 15, 45]],
  [/guitar/, 4, [105, 40, 12]],
  [/jacket|coat|clothes|clothing|sweater|shirt/, 1, [35, 28, 8]],
  [/phone|smartphone/, 0.3, [16, 8, 2]],
  [/plate|dishes|mug|cups?/, 2.5, [30, 30, 15]],
];

function emptyShipment(): Shipment {
  const none = { value: null, confidence: 0, source: "unknown" as const, evidence: "" };
  return {
    origin_country: { value: HOME_COUNTRY, confidence: 0.7, source: "inferred", evidence: "Default origin" },
    destination_country: { ...none },
    contents: { ...none },
    weight_kg: { ...none },
    length_cm: { ...none },
    width_cm: { ...none },
    height_cm: { ...none },
    declared_value_eur: { ...none },
    parcel_count: { value: 1, confidence: 0.8, source: "inferred", evidence: "Assumed one parcel" },
    urgency: { value: null, confidence: 0, source: "unknown", evidence: "" },
    is_fragile: false,
    is_business: false,
  };
}

function mockAnalyze(input: { history: ChatMessage[]; text: string; image: Img | null; link: LinkInfo | null; profile: Shipment | null }): Analysis {
  const s: Shipment = input.profile ? structuredClone(input.profile) : emptyShipment();
  const t = input.text.toLowerCase();
  const flags: { code: RiskCode; detail: string }[] = [];
  const said = (evidence: string) => ({ confidence: 0.95, source: "customer_stated" as const, evidence });
  const none = { value: null, confidence: 0, source: "unknown" as const, evidence: "" };
  // A new photo or link means a new item: forget the previous item's contents, weight and size.
  if (input.image || input.link?.ok) {
    for (const k of ["contents", "weight_kg", "length_cm", "width_cm", "height_cm", "declared_value_eur"] as const) {
      if (s[k].source !== "customer_stated") (s as Record<string, unknown>)[k] = { ...none };
    }
  }

  const to = t.match(/\bto\s+(?:the\s+)?([a-z ]+?)(?:[,.!?]|\s+(?:from|by|in|with|and|for)\b|$)/);
  const from = t.match(/\bfrom\s+(?:the\s+)?([a-z ]+?)(?:[,.!?]|\s+(?:to|by|in|with|and|for)\b|$)/);
  for (const [m, key] of [[to, "destination_country"], [from, "origin_country"]] as const) {
    const c = m && COUNTRIES.find((x) => m[1].trim().endsWith(x));
    if (c) s[key] = { value: cap(c), ...said(m![0]) };
  }
  if (!to) {
    const c = COUNTRIES.find((x) => new RegExp(`\\b${x}\\b`).test(t) && cap(x) !== s.origin_country.value);
    if (c && !s.destination_country.value) s.destination_country = { value: cap(c), confidence: 0.75, source: "inferred", evidence: `Mentioned ${c}` };
  }
  const w = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilo|g\b|grams)/);
  if (w) {
    const n = parseFloat(w[1].replace(",", "."));
    s.weight_kg = { value: /^g|gram/.test(w[2]) ? n / 1000 : n, ...said(w[0]) };
  }
  const d = t.match(/(\d+)\s*[x×*]\s*(\d+)\s*[x×*]\s*(\d+)/);
  if (d) {
    s.length_cm = { value: +d[1], ...said(d[0]) };
    s.width_cm = { value: +d[2], ...said(d[0]) };
    s.height_cm = { value: +d[3], ...said(d[0]) };
  }
  const v = t.match(/(?:worth|value[d]?(?: at)?|costs?)\s*(?:€|eur|nok|kr)?\s*(\d[\d.,]*)/);
  if (v) s.declared_value_eur = { value: parseFloat(v[1].replace(/[.,](?=\d{3})/g, "")), ...said(v[0]) };
  const n = t.match(/(\d+)\s*(?:parcels|packages|boxes)/);
  const monthly = /a month|per month|monthly|every month|each month|a week|per week/.test(t);
  if (n && !monthly) s.parcel_count = { value: +n[1], ...said(n[0]) };
  if (/fast|urgent|asap|tomorrow|express|quick/.test(t)) s.urgency = { value: "fastest", ...said("speed requested") };
  else if (/cheap|budget|lowest|not in a hurry|no rush/.test(t)) s.urgency = { value: "cheapest", ...said("price focus") };
  const ofX = t.match(/\b(?:box|parcel|package|bag|crate|pallet|envelope)\s+(?:of|with)\s+([a-z ]{3,30}?)(?:\s+(?:to|from|weighing)\b|[,.!?]|$)/);
  const contents =
    ofX ?? t.match(/\b(?:ship|send|post|mail)\s+(?:a|an|my|some|two|three|\d+)?\s*(?:[\d.,]+\s*kg\s+)?([a-z ]{3,40}?)(?:\s+(?:to|from|of|weighing|that|which)\b|[,.!?]|$)/);
  const KNOWN = /\b(books?|clothes|clothing|shoes|laptop|phone|documents?|power ?bank|glass(?:es)?|vase|ceramics?|electronics|toys?|furniture|chair|bike|bicycle|perfume|wine|cheese|medicine)\b/;
  const PRONOUN = /^(?:this|that|it|these|those|this one|this box|this item|something|stuff)$/;
  const lead = t.match(/^(?:i have |i've got )?(?:a|an|my|some)\s+([a-z ]{3,30}?)\s+(?:to|for|from)\b/);
  const pick = [contents, lead].find((m) => m && !PRONOUN.test(m[1].trim()) && !/parcel|package|month|week|box(?:es)?$/.test(m[1]));
  const desc = input.text.match(/^Description:\s*([^.\n]+)/i)?.[1]?.trim();
  if (pick) s.contents = { value: pick[1].trim(), ...said(pick[0]) };
  else if (desc && desc.split(" ").length <= 8) s.contents = { value: desc.replace(/^(?:a|an|my|some|the|this|that)\s+/i, "").toLowerCase(), ...said(desc) };
  else if (KNOWN.test(t)) s.contents = { value: t.match(KNOWN)![0], ...said(t.match(KNOWN)![0]) };

  if (input.link?.ok) {
    const st = input.link.structured ?? {};
    s.contents = { value: input.link.title ?? "product from link", confidence: 0.85, source: "product_page", evidence: input.link.url };
    const wt = JSON.stringify(st.weight ?? "").match(/(\d+(?:\.\d+)?)/);
    if (wt) s.weight_kg = { value: +(+wt[1] * 1.15).toFixed(2), confidence: 0.75, source: "product_page", evidence: `Item weight ${wt[1]} + packaging` };
    else if (!s.weight_kg.value) {
      const pw = input.link.textExcerpt?.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
      if (pw) s.weight_kg = { value: +(parseFloat(pw[1].replace(",", ".")) * 1.15).toFixed(2), confidence: 0.6, source: "page_text", evidence: pw[0] };
    }
  }
  if (input.image && !s.contents.value) {
    s.contents = { value: "the item in your photo", confidence: 0.4, source: "image_estimate", evidence: "Photo (offline demo mode can't see images)" };
  }
  // Typical sizes for common items, so offline estimates are sensible. Always marked as estimates.
  const typical = TYPICAL.find(([re]) => re.test((s.contents.value ?? "").toLowerCase()));
  const est = input.image ? ("image_estimate" as const) : ("inferred" as const);
  if (typical) {
    const [, kg, [l, w, h]] = typical;
    const ev = `Typical size for this kind of item${input.image ? " (rough read of the photo)" : ""}`;
    if (!s.weight_kg.value) s.weight_kg = { value: kg, confidence: 0.4, source: est, evidence: ev };
    if (!s.length_cm.value && !s.width_cm.value && !s.height_cm.value) {
      s.length_cm = { value: l, confidence: 0.45, source: est, evidence: ev };
      s.width_cm = { value: w, confidence: 0.45, source: est, evidence: ev };
      s.height_cm = { value: h, confidence: 0.45, source: est, evidence: ev };
    }
  } else if (input.image && !s.weight_kg.value) {
    s.weight_kg = { value: 3, confidence: 0.35, source: "image_estimate", evidence: "Rough estimate from photo" };
  }

  // Scan only what the customer wrote about the item - not the form's own labels ("fragile: unsure").
  const free = t.replace(/form answers:[\s\S]*$/, "");
  const all = `${free} ${(s.contents.value ?? "").toLowerCase()}`;
  const kw: [RegExp, RiskCode][] = [
    [/\b(gun|weapon|ammo|ammunition|firework|explosive|cash)\b/, "prohibited_item"],
    [/lithium|power ?bank|spare batter/, "lithium_battery"],
    [/perfume|liquid|wine|alcohol|oil\b/, "liquid"],
    [/food|cheese|fish|meat|perishable/, "perishable"],
    [/medicine|pills|prescription/, "medicine"],
    [/glass|ceramic|vase|fragile|porcelain/, "fragile"],
    [/complain|damaged|lost my|never arrived|refund/, "complaint"],
    [/human|real person|agent|speak to someone/, "customer_requested_human"],
  ];
  for (const [re, code] of kw) if (re.test(all)) flags.push({ code, detail: all.match(re)![0] });
  if (monthly && n && +n[1] >= 50) {
    flags.push({ code: "volume_customer", detail: `${n[1]} parcels per month` });
    s.is_business = true;
  }
  if ((s.declared_value_eur.value ?? 0) > 5000) flags.push({ code: "high_value", detail: `€${s.declared_value_eur.value}` });
  s.is_fragile = flags.some((f) => f.code === "fragile");

  const intent: Analysis["intent"] = flags.some((f) => f.code === "complaint")
    ? "complaint"
    : /track/.test(t)
      ? "tracking"
      : /^(hi|hello|hey)\b/.test(t) && t.length < 12
        ? "smalltalk"
        : "quote";
  const missing = !s.destination_country.value
    ? "Where is the parcel going?"
    : !s.contents.value
      ? "What are you shipping?"
      : !s.weight_kg.value && !s.length_cm.value
        ? "Roughly how much does it weigh packed (kg)?"
        : null;

  const known = [
    s.contents.value && `**${s.contents.value}**`,
    s.destination_country.value && `to **${s.destination_country.value}**`,
    s.weight_kg.value &&
      (s.weight_kg.source === "image_estimate"
        ? `roughly **${s.weight_kg.value} kg** (my estimate from the photo)`
        : `about **${s.weight_kg.value} kg**`),
  ].filter(Boolean);
  const reply =
    intent === "smalltalk"
      ? "Hi! I can recommend the right shipping option and give you an instant price. What would you like to send, and where?"
      : intent === "tracking"
        ? "For tracking, please enter your tracking number on our Track page. Is there anything you'd like to ship?"
        : `${known.length ? `Got it - ${known.join(" ")}.` : "Happy to help!"} ${
            missing ??
            (flags.some((f) => ["prohibited_item", "lithium_battery", "liquid", "perishable", "medicine", "high_value"].includes(f.code))
              ? "This item has special shipping rules, so I can't quote it on my own."
              : "Here's what I'd recommend, with an instant quote below.")
          }`;

  return {
    intent,
    shipment: s,
    risk_flags: flags,
    recommended_product_id: null,
    recommendation_reason: "Rule-based (offline demo mode)",
    suggested_add_on_ids: [],
    answer_confidence: intent === "quote" ? 0.8 : intent === "smalltalk" ? 0.95 : 0.5,
    uncertainty_notes: input.image ? "Offline demo mode cannot inspect photos" : "",
    missing_info_question: missing,
    packaging_note: s.is_fragile
      ? "Wrap it well and fill every gap so it can't move - fragile items break when they shift inside the box."
      : /laptop|phone|camera|electronic/.test(all)
        ? "Electronics should travel in a snug sleeve inside a padded box."
        : "",
    reply,
  };
}
