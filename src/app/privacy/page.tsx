import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { DataRequestForm } from "@/components/DataRequestForm";
import { RETENTION } from "@/lib/store";

export const metadata: Metadata = { title: "Privacy notice - Nopea" };

const ROWS: [string, string, string, string][] = [
  ["Preparing your quote", "Item description, postcodes, weight/size, optional photo or product link", "Steps at your request before a contract (Art. 6(1)(b)); photo: your consent (Art. 6(1)(a))", `${RETENTION.quoteDays} days if you don't order`],
  ["Delivering your order", "Sender & recipient name, address, email/phone, parcel details", "Contract (Art. 6(1)(b))", "Until delivered + claims period; bookkeeping data 6 years (Finnish Accounting Act)"],
  ["Human review of uncertain quotes", "The quote and your answers", "Contract and our legitimate interest in accurate pricing (Art. 6(1)(f))", "As above"],
  ["Anonymous usage statistics", "Steps viewed, time per step, buttons used, with a random visit id and no personal data", "Your consent (Art. 6(1)(a)), only if you allow statistics", `${Math.round(RETENTION.eventDays / 30)} months`],
  ["Service metrics", "Counts and timings of quotes and orders, not linked to you", "Legitimate interest (Art. 6(1)(f))", `${Math.round(RETENTION.eventDays / 30)} months`],
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto max-w-3xl px-4 py-4"><Logo /></div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-slate-700 [&_h2]:mt-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_p]:leading-relaxed">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Privacy notice</h1>
          <p className="mt-2 text-sm text-slate-500">Last updated November 2026 · Draft for the hackathon demo. Must be reviewed by legal counsel before launch.</p>
        </div>

        <section>
          <h2>Who we are</h2>
          <p>Nopea Oy (demo company, Business ID 0000000-0), Helsinki, Finland, is the data controller. Contact: privacy@nopea.example.</p>
        </section>

        <section>
          <h2>What we collect, why, and for how long</h2>
          <p>We collect only what we need to quote and deliver your parcel. You never need to create an account.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr><th className="py-2 pr-3">Purpose</th><th className="pr-3">Data</th><th className="pr-3">Legal basis (GDPR)</th><th>Kept for</th></tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r[0]} className="border-t border-slate-100 align-top">
                    {r.map((c, i) => <td key={i} className={`py-2 pr-3 ${i === 0 ? "font-medium text-slate-900" : ""}`}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>AI and human review</h2>
          <p>
            Our quote assistant uses AI to understand your item and suggest a product, packaging and price. Prices themselves come from our fixed price list.
            Whenever the AI is not confident, a member of our team reviews the quote. No decision with legal or similarly significant effects is made about you
            by automated means alone, and you can always ask for a person to review your quote.
          </p>
        </section>

        <section>
          <h2>Photos and product links</h2>
          <p>
            We only use a photo or link if you give permission when you add it. Photos are shrunk on your device and their location/camera data is removed
            before upload. They are used only to estimate size and weight, are never used to train AI models, and are deleted after {RETENTION.photoDays} days.
            Please avoid photos showing people or personal documents. For links, we visit the public page once to read the product details.
          </p>
        </section>

        <section id="cookies">
          <h2>Cookies and statistics</h2>
          <p>
            We don&apos;t use advertising or third-party tracking cookies. Necessary storage on your device remembers your privacy choice. If you allow statistics,
            we keep a random visit id in your browser tab (it disappears when you close the tab) and record anonymous events, like which step you reached and
            how long it took. These events contain no names, addresses, item descriptions or photos. You can change your choice at any time with &ldquo;Cookie settings&rdquo;
            in the footer.
          </p>
        </section>

        <section>
          <h2>Who we share data with</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>The delivering courier</strong>: recipient name and address, to deliver the parcel.</li>
            <li><strong>AI service provider</strong> (Anthropic): processes your item description, photo or link content under a data processing agreement, and doesn&apos;t use it to train models. It may be processed in the USA under the EU Standard Contractual Clauses.</li>
            <li><strong>Hosting provider</strong>: stores data within the EU/EEA.</li>
          </ul>
          <p className="mt-2">We never sell your data.</p>
        </section>

        <section>
          <h2>Your rights</h2>
          <p>
            You can access, download, correct or erase your data, object to processing, restrict it, and withdraw consent at any time. Withdrawing consent doesn&apos;t
            affect processing that already happened. Use the form below for the most common requests:
          </p>
          <div className="mt-4"><DataRequestForm /></div>
          <p className="mt-4">
            You also have the right to complain to the Finnish supervisory authority, the Office of the Data Protection Ombudsman (tietosuoja.fi).
          </p>
        </section>
      </main>
    </div>
  );
}
