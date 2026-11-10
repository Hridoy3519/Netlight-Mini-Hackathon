import Link from "next/link";
import { PRODUCTS, VAT } from "@/lib/catalog";
import { Logo } from "@/components/Logo";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Logo />
          <nav className="flex items-center gap-5 text-sm text-slate-600">
            <a href="#products" className="hidden hover:text-brand sm:inline">Products</a>
            <a href="#how" className="hidden hover:text-brand sm:inline">How it works</a>
            <Link href="/quote" className="hidden rounded-lg bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark sm:inline">Get a quote</Link>
            <Link href="/agent" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-brand hover:text-brand">Staff</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-gradient-to-br from-brand to-brand-dark text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm">🇫🇮 Parcels anywhere in Finland</div>
              <h1 className="text-4xl font-bold leading-tight md:text-5xl">Send it. <span className="text-accent">Nopea.</span><br />The right parcel, the right price, in a minute.</h1>
              <p className="mt-5 max-w-md text-lg text-white/80">
                Tell us what you&apos;re sending, share a product link or photo if you like, and we&apos;ll put together the right product, packaging and price for you. A real person steps in whenever our AI isn&apos;t sure.
              </p>
              <Link href="/quote" className="mt-8 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-slate-900 shadow-lg hover:brightness-105">
                Get my price →
              </Link>
            </div>
            <div className="hidden items-center md:flex">
              <div className="w-full space-y-3 rounded-2xl bg-white/10 p-5 backdrop-blur">
                {[
                  ["💬", "Tell us what it is", "“Two paperback books from Helsinki to Tampere”"],
                  ["🔗", "Share a link (optional)", "We read the size and weight from the product page"],
                  ["📷", "Show a photo (optional)", "Only with your permission, and deleted after 30 days"],
                ].map(([i, t, d]) => (
                  <div key={t} className="flex items-start gap-3 rounded-xl bg-white/10 p-3">
                    <span className="text-2xl">{i}</span>
                    <div>
                      <div className="font-semibold">{t}</div>
                      <div className="text-sm text-white/75">{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold">Honest about what it knows</h2>
          <p className="mt-2 max-w-2xl text-slate-600">
            Every answer is scored part by part: understanding your needs, the product, the price and our shipping rules. Confident parts are answered instantly; any uncertain part goes straight to a human specialist, and you see exactly why.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ["Instant when certain", "Clear requests get a recommendation and a fixed quote immediately, from our real price list."],
              ["Human when unsure", "Photo-based estimates, restricted goods or unclear needs are passed to a specialist within minutes."],
              ["Always within the rules", "Prohibited and restricted items are caught by hard rules, not left to the AI's judgement."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="font-semibold text-brand">{t}</div>
                <p className="mt-1 text-sm text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="products" className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-bold">Our products</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUCTS.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-accent">{p.speed}</div>
                  <div className="mt-1 text-lg font-semibold">{p.name}</div>
                  <p className="mt-1 text-sm text-slate-600">{p.tagline}</p>
                  <div className="mt-3 text-xs text-slate-500">
                    Up to {p.maxWeightKg} kg · from €{(p.basePrice.domestic * 1.08 * (1 + VAT)).toFixed(2)} incl. VAT
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span>Nopea is a fictional Finnish parcel company built for a hackathon demo.</span>
          <Link href="/privacy" className="underline hover:text-brand">Privacy</Link>
          <CookieSettingsButton className="underline hover:text-brand" />
        </div>
      </footer>
    </div>
  );
}
