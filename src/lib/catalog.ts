// Fictional company data for "Nopea". Swap these with the real
// catalog / price list when the case company provides one.

export type Zone = "domestic" | "nordic" | "eu" | "world";

export const HOME_COUNTRY = "Finland";

const NORDIC = ["norway", "sweden", "denmark", "finland", "iceland"];
const EU = [
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic", "czechia",
  "estonia", "france", "germany", "greece", "hungary", "ireland", "italy", "latvia",
  "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal", "romania",
  "slovakia", "slovenia", "spain", "switzerland", "united kingdom", "uk",
];

export function zoneFor(origin: string | null, destination: string | null): Zone | null {
  if (!origin || !destination) return null;
  const o = origin.trim().toLowerCase();
  const d = destination.trim().toLowerCase();
  if (o === d) return "domestic";
  const both = (list: string[]) => list.includes(o) && list.includes(d);
  if (both(NORDIC)) return "nordic";
  if ((NORDIC.includes(o) || EU.includes(o)) && (NORDIC.includes(d) || EU.includes(d))) return "eu";
  return "world";
}

export function needsCustoms(origin: string | null, destination: string | null): boolean {
  const z = zoneFor(origin, destination);
  if (!z || z === "domestic") return false;
  return true;
}

export interface Product {
  id: string;
  name: string;
  tagline: string;
  maxWeightKg: number;
  maxLengthCm: number; // longest side
  maxGirthCm?: number;
  zones: Zone[];
  basePrice: Record<Zone, number>; // EUR
  perKg: Record<Zone, number>; // EUR per chargeable kg above 1 kg
  transitDays: Record<Zone, [number, number]>;
  speed: "economy" | "standard" | "express";
  tracking: "basic" | "full";
  forBusiness?: boolean;
  documentsOnly?: boolean;
}

export const PRODUCTS: Product[] = [
  {
    id: "letter-plus",
    name: "Nopea Letter+",
    tagline: "Tracked envelopes for documents and flat items",
    maxWeightKg: 2,
    maxLengthCm: 35,
    zones: ["domestic", "nordic", "eu", "world"],
    basePrice: { domestic: 4.9, nordic: 7.9, eu: 9.9, world: 14.9 },
    perKg: { domestic: 0, nordic: 0, eu: 0, world: 0 },
    transitDays: { domestic: [1, 3], nordic: [2, 4], eu: [3, 6], world: [5, 10] },
    speed: "standard",
    tracking: "basic",
    documentsOnly: true,
  },
  {
    id: "parcel-economy",
    name: "Parcel Economy",
    tagline: "Lowest price for parcels that aren't in a hurry",
    maxWeightKg: 20,
    maxLengthCm: 120,
    zones: ["domestic", "nordic", "eu", "world"],
    basePrice: { domestic: 7.9, nordic: 13.9, eu: 17.9, world: 29.0 },
    perKg: { domestic: 0.45, nordic: 0.9, eu: 1.3, world: 3.2 },
    transitDays: { domestic: [3, 5], nordic: [4, 7], eu: [6, 10], world: [10, 20] },
    speed: "economy",
    tracking: "basic",
  },
  {
    id: "parcel-standard",
    name: "Parcel Standard",
    tagline: "Fully tracked, reliable everyday shipping",
    maxWeightKg: 30,
    maxLengthCm: 150,
    zones: ["domestic", "nordic", "eu", "world"],
    basePrice: { domestic: 10.9, nordic: 18.9, eu: 24.9, world: 39.0 },
    perKg: { domestic: 0.6, nordic: 1.2, eu: 1.7, world: 4.1 },
    transitDays: { domestic: [2, 3], nordic: [2, 4], eu: [3, 6], world: [6, 12] },
    speed: "standard",
    tracking: "full",
  },
  {
    id: "parcel-express",
    name: "Parcel Express",
    tagline: "Next business day domestically, priority handling abroad",
    maxWeightKg: 30,
    maxLengthCm: 150,
    zones: ["domestic", "nordic", "eu", "world"],
    basePrice: { domestic: 19.9, nordic: 34.9, eu: 44.9, world: 69.0 },
    perKg: { domestic: 0.9, nordic: 1.8, eu: 2.6, world: 6.0 },
    transitDays: { domestic: [1, 1], nordic: [1, 2], eu: [2, 3], world: [3, 5] },
    speed: "express",
    tracking: "full",
  },
  {
    id: "freight-pallet",
    name: "Pallet Freight",
    tagline: "Palletised freight for heavy or bulky business shipments",
    maxWeightKg: 1000,
    maxLengthCm: 240,
    zones: ["domestic", "nordic", "eu"],
    basePrice: { domestic: 89, nordic: 149, eu: 199, world: 0 },
    perKg: { domestic: 0.18, nordic: 0.32, eu: 0.45, world: 0 },
    transitDays: { domestic: [2, 4], nordic: [3, 5], eu: [4, 8], world: [0, 0] },
    speed: "standard",
    tracking: "full",
    forBusiness: true,
  },
];

export interface AddOn {
  id: string;
  name: string;
  description: string;
  price: (declaredValue: number | null) => number;
}

export const ADD_ONS: AddOn[] = [
  {
    id: "insurance",
    name: "Value Protection",
    description: "Covers loss or damage up to the declared value (max €5,000).",
    price: (v) => Math.max(4.9, Math.round((v ?? 0) * 0.012 * 100) / 100),
  },
  {
    id: "fragile",
    name: "Fragile Care",
    description: "Hand-sorted, 'fragile' labelled and kept upright.",
    price: () => 6.9,
  },
  {
    id: "signature",
    name: "Signature on Delivery",
    description: "Recipient signs on delivery.",
    price: () => 2.9,
  },
];

export const FUEL_SURCHARGE = 0.08; // 8%
export const VAT = 0.255; // Finnish general VAT rate 25.5%
export const VAT_LABEL = "incl. 25.5% VAT";
export const VOLUMETRIC_DIVISOR = 5000; // cm^3 / kg
export const QUOTE_VALIDITY_HOURS = 24;

export function catalogForPrompt(): string {
  const lines = PRODUCTS.map((p) => {
    const [a, b] = p.transitDays.domestic;
    return `- ${p.name} (id: ${p.id}): ${p.tagline}. Max ${p.maxWeightKg} kg, longest side ${p.maxLengthCm} cm.${
      p.documentsOnly ? " Documents/flat items only." : ""
    }${p.forBusiness ? " For heavy/bulky business shipments." : ""} Estimated delivery within Finland: ${a === b ? a : `${a}-${b}`} business day(s). Tracking: ${p.tracking}.`;
  });
  const addons = ADD_ONS.map((a) => `- ${a.name} (id: ${a.id}): ${a.description}`);
  return [
    "We ship within Finland only (sender and recipient both in Finland).",
    "Products:",
    ...lines,
    "Add-ons:",
    ...addons,
  ].join("\n");
}

/** Finnish postcodes are five digits. */
export const isFinnishPostcode = (p: string) => /^\d{5}$/.test(p.trim());
/** Åland Islands postcodes are 22xxx - outside the EU VAT area. */
export const isAland = (p: string) => /^22\d{3}$/.test(p.trim());

// ---------------------------------------------------------------------------
// Packaging materials sold with a shipment. Boxes define the packed size.
// ---------------------------------------------------------------------------

export interface PackagingItem {
  id: string;
  name: string;
  description: string;
  price: number; // EUR ex VAT
  kind: "box" | "envelope" | "protection";
  /** Inner dimensions in cm (boxes/envelopes) */
  inner?: [number, number, number];
  /** Outer dimensions in cm, used as the parcel size once packed */
  outer?: [number, number, number];
  weightKg?: number; // packaging's own weight
  maxLoadKg?: number;
}

export const PACKAGING: PackagingItem[] = [
  { id: "doc-envelope", name: "Document envelope", description: "Rigid A4 envelope for papers and photos.", price: 1.5, kind: "envelope", inner: [32, 23, 2], outer: [34, 25, 2], weightKg: 0.05, maxLoadKg: 0.5 },
  { id: "padded-envelope", name: "Padded envelope", description: "Bubble-lined envelope for small, flat items.", price: 2.9, kind: "envelope", inner: [33, 24, 5], outer: [35, 26, 6], weightKg: 0.08, maxLoadKg: 1 },
  { id: "box-s", name: "Box S", description: "Double-wall box, 30 × 20 × 15 cm.", price: 2.5, kind: "box", inner: [30, 20, 15], outer: [31, 21, 16], weightKg: 0.3, maxLoadKg: 10 },
  { id: "box-m", name: "Box M", description: "Double-wall box, 40 × 30 × 25 cm.", price: 3.9, kind: "box", inner: [40, 30, 25], outer: [41, 31, 26], weightKg: 0.5, maxLoadKg: 20 },
  { id: "box-l", name: "Box L", description: "Double-wall box, 60 × 40 × 40 cm.", price: 5.9, kind: "box", inner: [60, 40, 40], outer: [61, 41, 41], weightKg: 0.9, maxLoadKg: 30 },
  { id: "box-xl", name: "Box XL", description: "Heavy-duty box, 80 × 60 × 50 cm.", price: 8.9, kind: "box", inner: [80, 60, 50], outer: [81, 61, 51], weightKg: 1.4, maxLoadKg: 30 },
  { id: "bubble-wrap", name: "Bubble wrap (5 m)", description: "Wrap items so they don't move or knock.", price: 4.5, kind: "protection", weightKg: 0.2 },
  { id: "fragile-kit", name: "Fragile kit", description: "Foam corners, void fill and FRAGILE labels.", price: 6.9, kind: "protection", weightKg: 0.3 },
  { id: "electronics-sleeve", name: "Anti-static foam sleeve", description: "Protects laptops, screens and electronics.", price: 5.5, kind: "protection", weightKg: 0.2 },
];

export const COUNTRY_OPTIONS = [
  "Norway", "Sweden", "Denmark", "Finland", "Iceland",
  "Germany", "Netherlands", "Belgium", "France", "Spain", "Portugal", "Italy", "Austria", "Switzerland",
  "Poland", "Czechia", "Estonia", "Latvia", "Lithuania", "Ireland", "United Kingdom",
  "United States", "Canada", "Japan", "China", "India", "Australia", "Brazil",
];
