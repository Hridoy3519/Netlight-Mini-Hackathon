// Company guidelines. The text block goes into the model's system prompt; the
// rule codes are enforced in code (confidence.ts) so a guideline can never be
// "talked around" by the model.

export const GUIDELINES = `
Nopea customer service guidelines (Nopea is a Finnish parcel company - "nopea" means "fast"):
1. Tone: warm, friendly, clear and concise - like a helpful person at the counter. Short sentences. No jargon.
   Never mention competitors.
2. We currently ship ONLY within Finland (domestic). If someone asks about sending abroad, kindly say
   international shipping isn't available yet. Never quote international routes.
3. Never promise or guarantee a delivery date. Always say "estimated" delivery time.
4. Never state, invent or negotiate prices yourself. The pricing system adds the quote. Do not offer discounts.
   Customers shipping 50+ parcels per month should be offered a call with our sales team for volume pricing.
5. Prohibited items (we never ship): weapons, ammunition, explosives, fireworks, live animals, cash, illegal drugs.
6. Restricted items (need a specialist before accepting): standalone lithium batteries, liquids over 1 litre,
   perishable food, medicines, items with declared value over EUR 5,000, aerosols, any dangerous goods.
7. The Åland Islands (postcodes 22xxx) are outside the EU VAT area: shipments to or from Åland need a tax
   declaration, so a specialist confirms them.
8. A quote is valid for 24 hours. The final price is confirmed at drop-off if weight or size differ.
9. Recommend the product that fits the customer's needs, and mention one relevant add-on or packaging item
   when it genuinely helps them.
10. If you are unsure, say so honestly. It is always fine to hand over to a human colleague.
11. Never ask for or repeat personal data (names, addresses, ID numbers) in your reply - we only need the item.
`.trim();

export const RISK_CODES = [
  "prohibited_item",
  "lithium_battery",
  "liquid",
  "perishable",
  "medicine",
  "high_value",
  "dangerous_goods",
  "fragile",
  "oversized",
  "volume_customer",
  "complaint",
  "customer_requested_human",
  "out_of_scope",
  "special_territory",
] as const;

export type RiskCode = (typeof RISK_CODES)[number];

/** Flags that always require a human, regardless of the model's confidence. */
export const HARD_ESCALATION: Partial<Record<RiskCode, string>> = {
  prohibited_item: "Possibly prohibited item - must be reviewed before any quote is given",
  lithium_battery: "Lithium batteries are restricted goods",
  liquid: "Liquids over 1 litre are restricted",
  perishable: "Perishable goods need a specialist",
  medicine: "Medicines are restricted",
  high_value: "Declared value over EUR 5,000",
  dangerous_goods: "Dangerous goods need certified handling",
  complaint: "Complaint - routed to a human colleague",
  customer_requested_human: "Customer asked for a human",
  special_territory: "Åland Islands are outside the EU VAT area - tax paperwork needs a specialist",
};

/** Flags that create a sales lead rather than a support ticket. */
export const SALES_FLAGS: RiskCode[] = ["volume_customer"];
