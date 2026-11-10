// Deterministic pricing. The LLM never produces prices - it only extracts the
// shipment profile; every number the customer sees comes from here.

import {
  ADD_ONS,
  FUEL_SURCHARGE,
  PRODUCTS,
  Product,
  QUOTE_VALIDITY_HOURS,
  VAT,
  VOLUMETRIC_DIVISOR,
  Zone,
  needsCustoms,
  zoneFor,
} from "./catalog";
import { PACKAGING } from "./catalog";
import { packedShipment } from "./packaging";
import type { PackagingSuggestion, ProductQuote, QuoteExtra, QuoteResult, Selection, Shipment } from "./types";

const round = (n: number) => Math.round(n * 100) / 100;

export function chargeableWeight(s: Shipment, weightScale = 1, dimScale = 1): number | null {
  const w = s.weight_kg.value;
  const l = s.length_cm.value;
  const wi = s.width_cm.value;
  const h = s.height_cm.value;
  const vol = l && wi && h ? (l * dimScale * wi * dimScale * h * dimScale) / VOLUMETRIC_DIVISOR : null;
  if (w == null && vol == null) return null;
  return Math.max((w ?? 0) * weightScale, vol ?? 0, 0.1);
}

function longestSide(s: Shipment): number | null {
  const sides = [s.length_cm.value, s.width_cm.value, s.height_cm.value].filter(
    (x): x is number => typeof x === "number",
  );
  return sides.length ? Math.max(...sides) : null;
}

function isDocuments(s: Shipment): boolean {
  const c = (s.contents.value ?? "").toLowerCase();
  return /\b(documents?|letters?|papers|contracts?|certificates?|passports?|cards?|photo prints?)\b/.test(c);
}

export function eligibleProducts(s: Shipment, zone: Zone): Product[] {
  // Weight limits apply to the real weight; volumetric weight only affects the price.
  const w = s.weight_kg.value ?? chargeableWeight(s) ?? 0;
  const longest = longestSide(s) ?? 0;
  return PRODUCTS.filter((p) => {
    if (!p.zones.includes(zone)) return false;
    if (w > p.maxWeightKg) return false;
    if (longest > p.maxLengthCm) return false;
    if (p.documentsOnly && !isDocuments(s)) return false;
    // Pallets only make sense when a parcel product can't take it.
    if (p.forBusiness && w <= 30 && longest <= 150) return false;
    return true;
  });
}

function priceFor(p: Product, zone: Zone, cw: number, count: number): { lines: { label: string; amount: number }[]; ex: number } {
  const base = p.basePrice[zone];
  const weightPart = p.perKg[zone] * Math.max(0, cw - 1);
  const freight = (base + weightPart) * count;
  const fuel = freight * FUEL_SURCHARGE;
  const lines = [
    { label: `Freight${count > 1 ? ` (${count} parcels)` : ""}, ${round(cw)} kg chargeable`, amount: round(freight) },
    { label: `Fuel surcharge (${FUEL_SURCHARGE * 100}%)`, amount: round(fuel) },
  ];
  return { lines, ex: round(freight + fuel) };
}

function quoteProduct(p: Product, zone: Zone, s: Shipment, weightUncertainty: number): ProductQuote {
  const count = Math.max(1, Math.round(s.parcel_count.value ?? 1));
  const cw = chargeableWeight(s)!;
  const { lines, ex } = priceFor(p, zone, cw, count);
  const [a, b] = p.transitDays[zone];
  const q: ProductQuote = {
    productId: p.id,
    productName: p.name,
    tagline: p.tagline,
    transit: a === b ? `${a} business day${a > 1 ? "s" : ""} (estimated)` : `${a}-${b} business days (estimated)`,
    chargeableWeightKg: round(cw),
    lines,
    totalExVat: ex,
    totalIncVat: round(ex * (1 + VAT)),
  };
  if (weightUncertainty > 0.02) {
    const lowCw = chargeableWeight(s, 1 - weightUncertainty, 1 - weightUncertainty / 2)!;
    const highCw = chargeableWeight(s, 1 + weightUncertainty, 1 + weightUncertainty / 2)!;
    q.range = {
      low: round(priceFor(p, zone, lowCw, count).ex * (1 + VAT)),
      high: round(priceFor(p, zone, highCw, count).ex * (1 + VAT)),
    };
  }
  return q;
}

/** How much the weight could plausibly be off, as a fraction, from its confidence. */
export function weightUncertainty(s: Shipment): number {
  const c = Math.min(s.weight_kg.confidence, dimsConfidence(s));
  return Math.max(0, (1 - c) * 0.6);
}

export function dimsConfidence(s: Shipment): number {
  const ds = [s.length_cm, s.width_cm, s.height_cm];
  if (ds.every((d) => d.value == null)) return 1; // no dims given -> only actual weight counts
  return Math.min(...ds.map((d) => (d.value == null ? 0.3 : d.confidence)));
}

export interface QuoteInput {
  shipment: Shipment; // as described (unpacked)
  selection: Selection;
  aiPick: string | null;
  aiAddOnIds: string[];
  packagingSuggestions: PackagingSuggestion[];
}

/** Prices the order. Returns the quote plus the packed shipment the price is based on. */
export function buildQuote(input: QuoteInput): { quote: QuoteResult; packed: Shipment } | null {
  const { shipment: s, selection: sel } = input;
  const suggestedPack = input.packagingSuggestions.map((p) => p.id);
  const packIds = (sel.packagingIds ?? suggestedPack).filter((id) => PACKAGING.some((p) => p.id === id));
  const packed = packedShipment(s, packIds);

  const zone = zoneFor(packed.origin_country.value, packed.destination_country.value);
  if (!zone || chargeableWeight(packed) == null) return null;
  const eligible = eligibleProducts(packed, zone);
  const u = weightUncertainty(packed);
  const quotes = eligible.map((p) => quoteProduct(p, zone, packed, u));
  const byPrice = [...quotes].sort((a, b) => a.totalIncVat - b.totalIncVat);

  const rule = rulePick(packed);
  const recommendedId = quotes.find((q) => q.productId === input.aiPick)?.productId ?? quotes.find((q) => q.productId === rule)?.productId ?? byPrice[0]?.productId ?? null;
  const chosen = quotes.find((q) => q.productId === sel.productId) ?? quotes.find((q) => q.productId === recommendedId) ?? null;

  const suggestedAddOns = new Set(input.aiAddOnIds.filter((id) => ADD_ONS.some((a) => a.id === id)));
  if ((s.declared_value_eur.value ?? 0) >= 300) suggestedAddOns.add("insurance");
  if (s.is_fragile) suggestedAddOns.add("fragile");
  const selectedAddOns = new Set(sel.addOnIds ?? [...suggestedAddOns]);

  const addOns: QuoteExtra[] = ADD_ONS.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    price: round(a.price(s.declared_value_eur.value) * (1 + VAT)),
    suggested: suggestedAddOns.has(a.id),
    selected: selectedAddOns.has(a.id),
  }));
  const reasons = new Map(input.packagingSuggestions.map((p) => [p.id, p.reason]));
  const packaging: QuoteExtra[] = PACKAGING.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: round(p.price * (1 + VAT)),
    suggested: reasons.has(p.id),
    selected: packIds.includes(p.id),
    reason: reasons.get(p.id),
  }));

  const extras = [...addOns, ...packaging].filter((x) => x.selected).reduce((t, x) => t + x.price, 0);
  const grandTotal = round((chosen?.totalIncVat ?? 0) + extras);
  const grandRange = chosen?.range ? { low: round(chosen.range.low + extras), high: round(chosen.range.high + extras) } : undefined;

  return {
    packed,
    quote: {
      zone,
      recommended: chosen,
      recommendedId,
      alternatives: byPrice.filter((q) => q.productId !== chosen?.productId).slice(0, 2),
      options: byPrice,
      addOns,
      packaging,
      customsNote: needsCustoms(s.origin_country.value, s.destination_country.value),
      validUntil: new Date(Date.now() + QUOTE_VALIDITY_HOURS * 3600_000).toISOString(),
      grandTotal,
      grandRange,
    },
  };
}

/** The product a simple rule would pick, used to cross-check the model. */
export function rulePick(s: Shipment): string | null {
  const zone = zoneFor(s.origin_country.value, s.destination_country.value);
  if (!zone || chargeableWeight(s) == null) return null;
  const el = eligibleProducts(s, zone);
  if (!el.length) return null;
  const u = s.urgency.value;
  if (u === "fastest") return el.find((p) => p.speed === "express")?.id ?? el[0].id;
  if (u === "cheapest") {
    const z = zone;
    const cw = chargeableWeight(s)!;
    return [...el].sort(
      (a, b) => a.basePrice[z] + a.perKg[z] * cw - (b.basePrice[z] + b.perKg[z] * cw),
    )[0].id;
  }
  return el.find((p) => p.id === "parcel-standard")?.id ?? el[0].id;
}
