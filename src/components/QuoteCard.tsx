import type { QuoteResult } from "@/lib/types";

const eur = (n: number) => `€${n.toFixed(2)}`;

export function QuoteCard({ quote, preliminary, confirmed }: { quote: QuoteResult; preliminary?: boolean; confirmed?: boolean }) {
  const r = quote.recommended;
  if (!r) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        None of our standard products fit these details. A specialist can help with a custom solution.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white text-sm shadow-sm overflow-hidden">
      <div className="flex items-center justify-between bg-brand px-3 py-2 text-white">
        <span className="font-semibold">{confirmed ? "Confirmed quote" : preliminary ? "Preliminary estimate" : "Instant quote"}</span>
        <span className="text-xs opacity-80">{quote.zone.toUpperCase()}</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-brand">Recommended</div>
            <div className="font-semibold">{r.productName}</div>
            <div className="text-xs text-slate-500">{r.transit}</div>
          </div>
          <div className="text-right">
            {preliminary && r.range ? (
              <>
                <div className="text-lg font-bold">
                  {eur(r.range.low)}–{eur(r.range.high)}
                </div>
                <div className="text-[11px] text-slate-500">estimated range, incl. VAT</div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold">{eur(r.totalIncVat)}</div>
                <div className="text-[11px] text-slate-500">incl. 25% VAT</div>
              </>
            )}
          </div>
        </div>
        {!preliminary && (
          <ul className="border-t border-slate-100 pt-2 text-xs text-slate-600 space-y-0.5">
            {r.lines.map((l) => (
              <li key={l.label} className="flex justify-between gap-2">
                <span>{l.label}</span>
                <span>{eur(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {[...(quote.packaging ?? []), ...quote.addOns].some((a) => a.selected) && (
          <div className="border-t border-slate-100 pt-2">
            <div className="text-xs font-medium text-slate-700">Packaging &amp; extras</div>
            {[...(quote.packaging ?? []), ...quote.addOns].filter((a) => a.selected).map((a) => (
              <div key={a.id} className="flex justify-between gap-2 text-xs text-slate-600" title={a.description}>
                <span>+ {a.name}</span>
                <span>{eur(a.price)}</span>
              </div>
            ))}
          </div>
        )}
        {quote.alternatives.length > 0 && (
          <div className="border-t border-slate-100 pt-2">
            <div className="text-xs font-medium text-slate-700">Alternatives</div>
            {quote.alternatives.map((a) => (
              <div key={a.productId} className="flex justify-between gap-2 text-xs text-slate-600">
                <span>
                  {a.productName} <span className="text-slate-400">· {a.transit.replace(" (estimated)", "")}</span>
                </span>
                <span>{eur(a.totalIncVat)}</span>
              </div>
            ))}
          </div>
        )}
        {quote.grandTotal != null && (
          <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold">
            <span>Order total</span>
            <span>{preliminary && quote.grandRange ? `${eur(quote.grandRange.low)}–${eur(quote.grandRange.high)}` : eur(quote.grandTotal)}</span>
          </div>
        )}
        <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-500 space-y-0.5">
          {quote.customsNote && <div>• A customs declaration is needed for this route.</div>}
          <div>• Transit times are estimates, not guarantees.</div>
          <div>• Valid 24 h. Final price confirmed at drop-off if weight or size differ.</div>
        </div>
      </div>
    </div>
  );
}
