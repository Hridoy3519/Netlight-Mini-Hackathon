// Deterministic packaging advice: which box fits the item (with padding),
// and what protection the contents need. The AI's note explains it in words.

import { PACKAGING, type PackagingItem } from "./catalog";
import type { PackagingSuggestion, Shipment } from "./types";

const PAD_CM = 4; // padding around the item on each side

function fits(item: [number, number, number], inner: [number, number, number]) {
  const a = [...item].sort((x, y) => y - x);
  const b = [...inner].sort((x, y) => y - x);
  return a.every((v, i) => v + PAD_CM * 2 <= b[i] + 0.001);
}

const byId = (id: string) => PACKAGING.find((p) => p.id === id)!;

export function suggestPackaging(s: Shipment, alreadyPacked: "yes" | "no" | "unsure"): PackagingSuggestion[] {
  if (alreadyPacked === "yes") return [];
  const out: PackagingSuggestion[] = [];
  const c = (s.contents.value ?? "").toLowerCase();
  const w = s.weight_kg.value ?? null;
  const dims = [s.length_cm.value, s.width_cm.value, s.height_cm.value];
  const hasDims = dims.every((d) => typeof d === "number") as boolean;
  const item = dims as [number, number, number];

  if (/\b(documents?|letters?|papers|contracts?|certificates?|passports?)\b/.test(c)) {
    out.push({ id: "doc-envelope", reason: "Keeps documents flat and dry." });
    return out;
  }

  // Container: envelope for small flat light things, otherwise smallest box that fits.
  const flatSmall = hasDims && Math.min(...item) <= 4 && Math.max(...item) <= 30 && (w ?? 0) <= 1 && !s.is_fragile;
  let container: PackagingItem | undefined;
  if (flatSmall) container = byId("padded-envelope");
  else {
    const boxes = PACKAGING.filter((p) => p.kind === "box");
    if (hasDims) container = boxes.find((b) => fits(item, b.inner!) && (w == null || w <= b.maxLoadKg!));
    else if (w != null) container = w <= 4 ? byId("box-s") : w <= 12 ? byId("box-m") : byId("box-l");
  }
  if (container)
    out.push({
      id: container.id,
      reason: hasDims
        ? `Smallest box that fits your item with ${PAD_CM} cm padding on every side.`
        : "Sized from the estimated weight - adjust if your item is bulkier.",
    });
  else if (hasDims) {
    // Too big for our boxes: protect it instead of boxing it.
    out.push({ id: "bubble-wrap", reason: "Too large for our standard boxes - wrap it well and protect the corners." });
    if (!s.is_fragile) out.push({ id: "fragile-kit", reason: "Foam corners protect the edges of large items in transit." });
  }

  if (s.is_fragile) {
    if (!out.some((o) => o.id === "bubble-wrap")) out.push({ id: "bubble-wrap", reason: "Fragile item: wrap it so it can't move inside the box." });
    if (!out.some((o) => o.id === "fragile-kit")) out.push({ id: "fragile-kit", reason: "Foam corners and FRAGILE labels for careful handling." });
  }
  if (/laptop|computer|tablet|monitor|screen|camera|console|phone|electronic/.test(c)) {
    out.push({ id: "electronics-sleeve", reason: "Electronics travel safest in an anti-static foam sleeve." });
  }
  return out;
}

/** Apply the selected box/envelope to get the packed parcel the price is based on. */
export function packedShipment(s: Shipment, packagingIds: string[]): Shipment {
  const items = packagingIds.map((id) => PACKAGING.find((p) => p.id === id)).filter(Boolean) as PackagingItem[];
  if (!items.length) return s;
  const p = structuredClone(s);
  const container = items.find((i) => i.outer);
  const extraKg = items.reduce((t, i) => t + (i.weightKg ?? 0), 0);
  if (p.weight_kg.value != null) p.weight_kg.value = Math.round((p.weight_kg.value + extraKg) * 100) / 100;
  const itemDims = [p.length_cm.value, p.width_cm.value, p.height_cm.value];
  const itemFits = !itemDims.every((d) => typeof d === "number") || fits(itemDims as [number, number, number], container?.inner ?? [0, 0, 0]);
  // Only use the box size when the item actually fits in it (never shrink the parcel).
  if (container?.outer && itemFits) {
    const [l, w, h] = container.outer;
    // We sell the box, so its size is known exactly.
    p.length_cm = { value: l, confidence: 1, source: "customer_stated", evidence: `${container.name} outer size` };
    p.width_cm = { value: w, confidence: 1, source: "customer_stated", evidence: `${container.name} outer size` };
    p.height_cm = { value: h, confidence: 1, source: "customer_stated", evidence: `${container.name} outer size` };
  }
  return p;
}
