# Nopea: AI-guided parcel quotes for Finland

Hackathon case: *smarter customer service for a shipping company.* Nopea ("fast" in Finnish) is a fictional Finnish parcel company. Instead of a chatbot, customers answer a short, friendly questionnaire. The AI then fills in an **editable order form** with the right product, packaging and price, and the customer can **Edit** it or **Place the order**. Anything the AI shouldn't decide on its own goes to a human specialist.

**Scope:** domestic shipping within Finland only. International isn't supported yet.

## Run it

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY, or keep MOCK_AI=1 for offline mode
npm run dev
```

| URL | What |
|---|---|
| `http://localhost:3000` | Customer website |
| `http://localhost:3000/quote` | The quote questionnaire |
| `http://localhost:3000/privacy` | Privacy notice and self-service data requests |
| `http://localhost:3000/agent` | Specialist console (staff login) |
| `http://localhost:3000/agent/analytics` | Analytics dashboard (staff login) |

**Demo data:** with the dev server running, `python3 scripts/seed-demo.py` fills the console and dashboard. It creates 11 quotes and 8 orders through the real APIs, has a specialist ("Pirjo") resolve 2 tickets, leaves 3 open (Åland, perishable cheese, a sales lead), and adds synthetic analytics traffic. Run `rm .data/store.json` first to start clean.

The staff login is `nopea` / `demo` in development (`AGENT_USER` / `AGENT_PASSWORD`). Without an API key the app runs in **offline demo mode**, using a rule-based extractor that can't actually see photos.

## Demo settings (in `.env.local`)

- `CONFIDENCE_FLOOR=0.95`: **demo only.** Every confidence score is rescaled into 95–100%, so the AI always appears confident and nothing goes to a human for low confidence. Company rules (restricted goods, the Åland Islands, prohibited items) **still** go to a human. Delete the line to get honest scores back.
- `MOCK_AI=1`: offline mode without Claude.

## Customer flow (`/quote`)

1. **Your item:** "What are you sending?", with example chips.
2. **Photo & link (optional):** a product link or photo. Each one **asks permission first** (what it's used for, no AI training, location data stripped in the browser, deleted after 30 days).
3. **Speed:** lowest price, best value or fastest.
4. **Details:** whether it's already packed, whether it's fragile, and weight, size, value and number of parcels. All optional.
5. **AI thinking**, then an **editable quote**: shipment details with their sources, the recommended product and alternatives, suggested packaging with a packing tip, extras, and the total incl. 25.5% VAT.
6. **Edit** (re-priced straight away) or **Place order**, which asks for sender and recipient details and an acknowledgement of the privacy notice. You then get an order number.

## GDPR

- **Consent banner:** only strictly necessary storage by default. Statistics are opt-in, and declining is as easy as accepting. Choices can be changed later via "Cookie settings".
- **Permission before a photo or link** is used, with a clear purpose for each.
- **Data minimisation:** photos are resized and stripped of EXIF metadata in the browser, and the AI is told not to repeat personal data. Postcodes and addresses are asked for only at checkout.
- **Retention (`purgeExpired`):** quotes that never became orders, including photos, are deleted after 30 days; photos on orders are removed after 30 days; analytics events after 13 months.
- **Data-subject rights (`/privacy`):** download your data (access and portability) or erase it, using the order number and sender email. Erasure keeps only the non-personal bookkeeping record the Finnish Accounting Act requires. A "Delete this quote and my photo" link is also on the quote page.
- **Transparency (GDPR Art. 22 / EU AI Act):** the AI's involvement is disclosed, a human reviews uncertain cases, and nothing is decided about a person by automated means alone.
- **Security:** staff pages and APIs require a login; customer quote ids are long random keys.
- The privacy notice is a **draft for legal review**. It covers the controller, purposes, legal bases, processors (the AI provider, under SCCs), retention and the right to complain to the Data Protection Ombudsman.

## Analytics (`/agent/analytics`)

There are two kinds of data, both free of personal data:

- **Service metrics** (every quote, anonymous, no session link): quote → order conversion, revenue and average order value, share answered by AI vs. sent to a human, average confidence, AI response time, quote → order time, photo and link usage, link-read success rate, packaging and add-on attach rates, specialist response time, tickets closed automatically after an edit, and product mix.
- **Behaviour metrics** (only visitors who allowed statistics; a random id per browser tab): funnel by step, time per step, time to quote and time to order, **edit click rate** and conversion after editing vs. without, photo and link permission rates, drop-off by step, order-form errors, and deleted quotes.

Event names and properties are allow-listed in `src/lib/analytics-schema.ts`, and the server drops anything else. **Generate demo traffic** fills the dashboard for a pitch; it's clearly labelled and can be removed with one click.

## Code map

| File | Purpose |
|---|---|
| `src/lib/catalog.ts`, `guidelines.ts` | Products, prices, packaging, company rules (swap in real data) |
| `src/lib/analyze.ts` | Claude call: structured extraction with per-field confidence and sources |
| `src/lib/quote.ts`, `packaging.ts` | Deterministic pricing and packaging choice (the AI never sets prices) |
| `src/lib/confidence.ts` | Per-part confidence scoring and the hand-off decision |
| `src/lib/service.ts` | Assess, re-price, place order, specialist resolution |
| `src/lib/store.ts` | JSON-file store, retention purge, data-rights operations, events |
| `src/lib/analytics-*.ts`, `metrics.ts` | Consent-aware tracking, event schema, dashboard metrics |
| `src/proxy.ts` | Staff login for `/agent` and the staff APIs |

## Demo script

| Do this in `/quote` | What happens |
|---|---|
| "Two paperback books" → skip → Best value → 1.2 kg, 22×15×6, not packed | 97%+ confidence, an instant price, and a box suggested |
| "A ceramic vase", fragile, value €600 | Box, bubble wrap and fragile kit suggested, plus insurance and Fragile Care |
| Add a photo | A permission dialog appears first; the AI estimates size and weight, which are labelled as estimates |
| "A power bank" | Restricted goods: the order is accepted as *pending review*; a specialist approves it in `/agent` |
| Click **Edit**, change the weight, **Save** | Instant re-price; shows up as an edit in the analytics |
| `/agent/analytics` → *Generate demo traffic* | Funnel, conversion, edit rate and time-to-quote dashboards |
