"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Conversation, Order, Shipment, Ticket } from "@/lib/types";
import { ConfidencePanel } from "@/components/ConfidencePanel";
import { QuoteCard } from "@/components/QuoteCard";
import { RichText } from "@/components/RichText";

type Row = Ticket & { conversation: Conversation | null; orders: Order[] };
type Stats = {
  conversations: number;
  aiReplies: number;
  autoResolved: number;
  askedCustomer: number;
  delegated: number;
  openTickets: number;
  salesLeads: number;
  quotesGiven: number;
  ordersPlaced: number;
  ordersConfirmed: number;
};

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export default function AgentConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("Ingrid");

  const refresh = useCallback(async () => {
    const r = await fetch(new URL("/api/tickets", location.origin), { cache: "no-store" });
    const d = await r.json();
    setRows(d.tickets);
    setStats(d.stats);
  }, []);

  useEffect(() => {
    // refresh() only sets state after an awaited fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const open = rows.filter((r) => r.status === "open");
  const done = rows.filter((r) => r.status === "resolved");
  const current = rows.find((r) => r.id === selected) ?? open[0] ?? null;
  const handledByAi = stats && stats.aiReplies ? Math.round(((stats.autoResolved + stats.askedCustomer) / stats.aiReplies) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-extrabold text-brand">nopea</Link>
          <span className="text-slate-300">/</span>
          <span className="font-semibold">Specialist console</span>
        </div>
        <Link href="/agent/analytics" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">📊 Analytics</Link>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Signed in as
          <input value={agentName} onChange={(e) => setAgentName(e.target.value)} className="w-28 rounded border border-slate-200 px-2 py-1" />
        </label>
      </header>

      {stats && (
        <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-4 lg:grid-cols-7">
          {[
            ["AI replies", stats.aiReplies],
            ["Handled by AI", `${handledByAi}%`],
            ["Quotes given", stats.quotesGiven],
            ["Orders placed", stats.ordersPlaced],
            ["Delegated parts", stats.delegated],
            ["Open tickets", stats.openTickets],
            ["Sales leads", stats.salesLeads],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="text-xs text-slate-500">{l}</div>
              <div className="text-xl font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid flex-1 gap-4 p-5 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          <TicketList title={`Needs a human (${open.length})`} rows={open} current={current?.id} onSelect={setSelected} />
          <TicketList title="Resolved" rows={done.slice(0, 15)} current={current?.id} onSelect={setSelected} />
        </aside>
        <main>
          {current ? (
            <TicketDetail key={current.id} t={current} agentName={agentName} onDone={refresh} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl bg-white text-sm text-slate-500 shadow-sm">
              Nothing needs a human right now. The AI is handling it. 🎉
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function TicketList({ title, rows, current, onSelect }: { title: string; rows: Row[]; current?: string; onSelect: (id: string) => void }) {
  return (
    <div className="rounded-xl bg-white shadow-sm">
      <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold">{title}</div>
      {rows.length === 0 && <div className="px-3 py-4 text-xs text-slate-400">None</div>}
      {rows.map((r) => {
        const firstCustomer = r.conversation?.messages.find((m) => m.role === "customer");
        return (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50 ${current === r.id ? "bg-brand/5" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase ${r.kind === "sales" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"}`}>
                {r.kind === "sales" ? "Sales lead" : r.parts.join(" · ") || "support"}
              </span>
              <span className="text-[11px] text-slate-400">{ago(r.createdAt)}</span>
            </div>
            <div className="mt-1 truncate text-sm">
              {r.conversation?.answers?.description || r.shipment?.contents.value || firstCustomer?.text || firstCustomer?.attachments?.[0]?.name || "(attachment)"}
            </div>
            <div className="truncate text-xs text-slate-500">{r.confidence?.hardFlags[0] ?? r.reasons[0]}</div>
          </button>
        );
      })}
    </div>
  );
}

function ShipmentTable({ s }: { s: Shipment }) {
  const rows: [string, { value: unknown; confidence: number; source: string; evidence: string }][] = [
    ["Origin", s.origin_country],
    ["Destination", s.destination_country],
    ["Contents", s.contents],
    ["Weight (kg)", s.weight_kg],
    ["Length (cm)", s.length_cm],
    ["Width (cm)", s.width_cm],
    ["Height (cm)", s.height_cm],
    ["Value (EUR)", s.declared_value_eur],
    ["Parcels", s.parcel_count],
    ["Speed", s.urgency],
  ];
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-slate-400">
        <tr>
          <th className="py-1 font-medium">Field</th>
          <th className="font-medium">Value</th>
          <th className="font-medium">Source</th>
          <th className="font-medium">Conf.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([n, f]) => (
          <tr key={n} className="border-t border-slate-100" title={f.evidence}>
            <td className="py-1 text-slate-500">{n}</td>
            <td className="font-medium">{f.value == null ? "—" : String(f.value)}</td>
            <td className="text-slate-500">{f.source.replace("_", " ")}</td>
            <td className={`tabular-nums ${f.value == null ? "text-slate-300" : f.confidence < 0.6 ? "text-rose-600" : f.confidence < 0.8 ? "text-amber-600" : "text-emerald-600"}`}>
              {f.value == null ? "—" : `${Math.round(f.confidence * 100)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TicketDetail({ t, agentName, onDone }: { t: Row; agentName: string; onDone: () => void }) {
  const rec = t.quote?.recommended;
  const [price, setPrice] = useState(t.quote?.grandTotal != null ? t.quote.grandTotal.toFixed(2) : rec ? rec.totalIncVat.toFixed(2) : "");
  const [reply, setReply] = useState(() => {
    if (t.kind === "sales") return "Hi! Thanks for your interest. I'm from our business team and would love to set up volume pricing for you. What's the best email or phone number to reach you?";
    if (t.confidence?.hardFlags.length) return "Hi! I've reviewed your shipment. ";
    if (rec) return `Hi! I've checked your shipment and confirmed the price for ${rec.productName}. Let me know if you'd like to book it!`;
    return "Hi! I've looked into your question: ";
  });
  const [busy, setBusy] = useState(false);
  const photos = t.conversation?.messages.flatMap((m) => m.attachments?.filter((a) => a.kind === "image" && a.dataUrl) ?? []) ?? [];

  async function resolve(approveQuote: boolean, withPrice: boolean) {
    setBusy(true);
    await fetch(new URL("/api/tickets", location.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketId: t.id,
        text: reply,
        agentName,
        approveQuote,
        confirmedTotal: withPrice && price ? parseFloat(price) : null,
      }),
    });
    setBusy(false);
    onDone();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Why this was delegated</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs ${t.status === "open" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
              {t.status === "open" ? "Waiting for you" : `Resolved by ${t.agentName}`}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {t.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
          {t.confidence && (
            <div className="mt-3">
              <ConfidencePanel report={t.confidence} defaultOpen />
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">Conversation</h2>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {t.conversation?.messages.map((m) => (
              <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.role === "customer" ? "bg-slate-100" : m.role === "human" ? "bg-indigo-50" : "border border-slate-100"}`}>
                <div className="mb-0.5 text-[11px] font-semibold uppercase text-slate-400">
                  {m.role === "customer" ? "Customer" : m.role === "human" ? m.agentName : "AI assistant"} · {ago(m.at)}
                </div>
                <RichText text={m.text || "(no text)"} />
                {m.attachments?.map((a, i) =>
                  a.kind === "link" ? (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand underline">🔗 {a.summary ?? a.url}</a>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={a.dataUrl} alt="" className="mt-1 max-h-32 rounded" />
                  ),
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        {t.shipment && (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold">What the AI extracted</h2>
            {photos.length > 0 && (
              <div className="mb-2 flex gap-2">
                {photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={p.dataUrl} alt="" className="h-20 rounded border border-slate-200" />
                ))}
              </div>
            )}
            <ShipmentTable s={t.shipment} />
          </section>
        )}
        {t.orders.length > 0 && (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold">Orders</h2>
            {t.orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 border-t border-slate-100 py-1.5 text-sm first:border-0">
                <span className="font-mono">{o.id}</span>
                <span className="truncate text-slate-500">{o.recipient.name}, {o.recipient.city}</span>
                <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase ${o.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>
                  {o.status === "confirmed" ? "Confirmed" : "Awaiting you"}
                </span>
              </div>
            ))}
            {t.orders.some((o) => o.status === "pending_review") && (
              <p className="mt-1 text-[11px] text-slate-400">Sending a confirmed price approves the pending order.</p>
            )}
          </section>
        )}
        {t.quote && (
          <section>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">AI&apos;s draft quote</div>
            <QuoteCard quote={t.quote} />
          </section>
        )}
        {t.status === "open" ? (
          <section className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Reply to customer</h2>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-brand" />
            {rec && (
              <label className="flex items-center gap-2 text-sm">
                Confirmed order total (€, incl. VAT)
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="w-28 rounded border border-slate-200 px-2 py-1" />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              {rec && (
                <button disabled={busy} onClick={() => resolve(true, true)} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                  Send with confirmed price
                </button>
              )}
              <button disabled={busy} onClick={() => resolve(false, false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50">
                Send reply only
              </button>
            </div>
            <p className="text-[11px] text-slate-400">Your reply appears instantly in the customer&apos;s chat.</p>
          </section>
        ) : (
          <section className="rounded-xl bg-white p-4 text-sm shadow-sm">
            <h2 className="mb-1 font-semibold">Resolution</h2>
            <p className="text-slate-600">{t.resolution}</p>
          </section>
        )}
      </div>
    </div>
  );
}
