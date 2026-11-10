"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Metrics } from "@/lib/metrics";

// Chart colours: validated categorical slots 1-3 (blue, orange, aqua) from the
// reference palette. Single-series charts use slot 1.
const C1 = "#2a78d6";
const C2 = "#eb6834";
const C3 = "#1baf7a";

const STEP_LABEL: Record<string, string> = {
  item: "Item",
  extras: "Photo & link",
  speed: "Speed",
  details: "Details",
  quote: "Quote shown",
  address: "Address",
  done: "Order placed",
};

const pct = (x: number | null, digits = 0) => (x == null ? "–" : `${(x * 100).toFixed(digits)}%`);
const dur = (ms: number | null) => {
  if (ms == null) return "–";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = s / 60;
  return m < 60 ? `${m.toFixed(1)} min` : `${(m / 60).toFixed(1)} h`;
};
const eur = (n: number | null) => (n == null ? "–" : `€${n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

type Tip = { x: number; y: number; text: string } | null;

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ metrics: Metrics; demoEvents: number; totalEvents: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState<Tip>(null);

  const load = useCallback(async () => {
    const r = await fetch(new URL(`/api/analytics?days=${days}`, location.origin), { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [days]);

  useEffect(() => {
    // load() only sets state after an awaited fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function demo(action: "seed_demo" | "clear_demo") {
    setBusy(true);
    await fetch(new URL("/api/analytics", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    await load();
    setBusy(false);
  }

  const showTip = (e: React.MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text });
  const hideTip = () => setTip(null);

  if (!data) return <div className="p-10 text-sm text-slate-500">Loading analytics…</div>;
  const { service: s, behaviour: b } = data.metrics;
  const funnelMax = Math.max(1, ...b.funnel.map((f) => f.sessions));
  const dayMax = Math.max(1, ...s.daily.map((d) => Math.max(d.quotes, d.orders)));
  const stepMax = Math.max(1, ...b.medianStepMs.map((x) => x.ms ?? 0));
  const abandonMax = Math.max(1, ...b.abandonByStep.map((x) => x.count));

  return (
    <div className="min-h-screen bg-slate-100 pb-16" onMouseLeave={hideTip}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-extrabold text-brand">nopea</Link>
          <span className="text-slate-300">/</span>
          <Link href="/agent" className="text-slate-500 hover:text-brand">Specialist console</Link>
          <span className="text-slate-300">/</span>
          <span className="font-semibold">Analytics</span>
        </div>
        {/* Filters: one row, above all charts */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Date range">
            {[7, 30, 90].map((d) => (
              <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 ${days === d ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {d} days
              </button>
            ))}
          </div>
          {data.demoEvents > 0 ? (
            <button disabled={busy} onClick={() => demo("clear_demo")} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800">Remove demo data</button>
          ) : (
            <button disabled={busy} onClick={() => demo("seed_demo")} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-brand">Generate demo traffic</button>
          )}
        </div>
      </header>

      {data.demoEvents > 0 && (
        <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠️ Includes {data.demoEvents.toLocaleString()} synthetic demo events. Remove them before reading real results.
        </div>
      )}

      <main className="space-y-5 px-5 pt-5">
        {/* Headline success criteria */}
        <section aria-label="Key results" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Quote → order conversion" value={pct(s.conversion, 1)} sub={`${s.orders} orders from ${s.quotes} quotes`} hero />
          <Kpi label="Handled fully by AI" value={pct(s.aiAuto)} sub={`${pct(s.aiDelegated)} needed a human`} hero />
          <Kpi label="Median time to quote" value={dur(b.medianTimeToQuoteMs)} sub="from first question" />
          <Kpi label="Median time to order" value={dur(b.medianTimeToOrderMs)} sub="from first question" />
          <Kpi label="Revenue" value={eur(s.revenue)} sub={`avg order ${eur(s.avgOrderValue)}`} />
          <Kpi label="Median AI response" value={dur(s.medianAiMs)} sub="questionnaire → quote" />
          <Kpi label="Specialist response" value={dur(s.medianSpecialistWaitMs)} sub={`${s.ticketsResolved} resolved, ${s.ticketsAutoClosed} auto-closed`} />
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          {/* Funnel */}
          <Card title="Funnel" subtitle={`Visitors who allowed statistics (${b.sessions} sessions). Share of those who started.`}>
            <div className="space-y-2">
              {b.funnel.map((f) => {
                const start = b.funnel[0].sessions || 1;
                const label = `${STEP_LABEL[f.step]}: ${f.sessions} sessions (${pct(f.sessions / start)} of starters)`;
                return (
                  <div key={f.step} className="grid grid-cols-[110px_1fr_80px] items-center gap-3 text-sm">
                    <span className="text-slate-600">{STEP_LABEL[f.step]}</span>
                    <div className="relative h-6" onMouseMove={(e) => showTip(e, label)} onMouseLeave={hideTip}>
                      <div className="h-6 rounded-r" style={{ width: `${Math.max(0.5, (f.sessions / funnelMax) * 100)}%`, background: C1, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
                    </div>
                    <span className="text-right tabular-nums text-slate-700">
                      {f.sessions} <span className="text-slate-400">· {pct(f.sessions / start)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <DataTable head={["Step", "Sessions", "% of starters"]} rows={b.funnel.map((f) => [STEP_LABEL[f.step], String(f.sessions), pct(f.sessions / (b.funnel[0].sessions || 1))])} />
          </Card>

          {/* Daily volume */}
          <Card title="Quotes and orders per day" subtitle="All traffic (anonymous service metrics)">
            <Legend items={[["Quotes", C1], ["Orders", C2]]} />
            <div className="mt-3 flex h-48 items-end gap-1.5 border-b border-slate-200">
              {s.daily.map((d) => (
                <div
                  key={d.day}
                  className="flex h-full flex-1 items-end justify-center gap-[2px]"
                  onMouseMove={(e) => showTip(e, `${d.day}: ${d.quotes} quotes, ${d.orders} orders`)}
                  onMouseLeave={hideTip}
                >
                  <div style={{ height: `${(d.quotes / dayMax) * 100}%`, background: C1, borderRadius: "4px 4px 0 0" }} className="w-1/2 max-w-4" />
                  <div style={{ height: `${(d.orders / dayMax) * 100}%`, background: C2, borderRadius: "4px 4px 0 0" }} className="w-1/2 max-w-4" />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-400">
              <span>{s.daily[0]?.day}</span>
              <span>{s.daily.at(-1)?.day}</span>
            </div>
            <DataTable head={["Day", "Quotes", "Orders"]} rows={s.daily.map((d) => [d.day, String(d.quotes), String(d.orders)])} />
          </Card>

          {/* AI confidence */}
          <Card title="How quotes were handled" subtitle="Decision made by the confidence engine for each new quote">
            <Legend items={[["Answered by AI", C1], ["Asked customer", C2], ["Sent to a human", C3]]} />
            <div className="mt-3 flex h-8 w-full gap-[2px] overflow-hidden rounded">
              {(
                [
                  ["Answered by AI", s.aiAuto, C1],
                  ["Asked customer", s.aiAsk, C2],
                  ["Sent to a human", s.aiDelegated, C3],
                ] as const
              ).map(([l, v, c]) =>
                v ? (
                  <div key={l} style={{ width: `${v * 100}%`, background: c }} className="flex items-center justify-center text-xs font-semibold text-white" onMouseMove={(e) => showTip(e, `${l}: ${pct(v, 1)}`)} onMouseLeave={hideTip}>
                    {v > 0.08 ? pct(v) : ""}
                  </div>
                ) : null,
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Avg confidence" value={pct(s.avgConfidence)} />
              <Mini label="Edits that removed the need for a human" value={String(s.editsRemovedHuman)} />
              <Mini label="Tickets auto-closed" value={String(s.ticketsAutoClosed)} />
              <Mini label="Orders awaiting review" value={String(s.pendingOrders)} />
            </div>
          </Card>

          {/* Engagement */}
          <Card title="Engagement" subtitle="How people use the questionnaire and the editable quote">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Mini label="Clicked Edit on quote" value={pct(b.editClickRate)} />
              <Mini label="Ordered after editing" value={pct(b.editToOrderRate)} hint={`vs ${pct(b.noEditToOrderRate)} without editing`} />
              <Mini label="Quotes with a photo" value={pct(s.photoShare)} />
              <Mini label="Quotes with a link" value={pct(s.linkShare)} hint={`${pct(s.linkReadSuccess)} links read OK`} />
              <Mini label="Photo permission granted" value={pct(b.photoPermissionRate)} hint={`${b.photoAskCount} asked`} />
              <Mini label="Link permission granted" value={pct(b.linkPermissionRate)} hint={`${b.linkAskCount} asked`} />
              <Mini label="Packaging added to order" value={pct(s.packagingAttach)} />
              <Mini label="Extras added to order" value={pct(s.addOnAttach)} />
              <Mini label="Quotes deleted by user" value={String(b.quotesDeleted)} />
            </div>
          </Card>

          {/* Time per step */}
          <Card title="Time spent per step" subtitle="Median, for sessions that completed the step">
            <div className="space-y-2">
              {b.medianStepMs.map((x) => (
                <div key={x.step} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-sm" onMouseMove={(e) => showTip(e, `${STEP_LABEL[x.step]}: median ${dur(x.ms)} (n=${x.n})`)} onMouseLeave={hideTip}>
                  <span className="text-slate-600">{STEP_LABEL[x.step]}</span>
                  <div className="h-5">
                    <div className="h-5" style={{ width: `${Math.max(0.5, ((x.ms ?? 0) / stepMax) * 100)}%`, background: C1, borderRadius: "0 4px 4px 0" }} />
                  </div>
                  <span className="text-right tabular-nums text-slate-700">{dur(x.ms)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Drop-off */}
          <Card title="Where people leave" subtitle="Last step seen before closing the page">
            {b.abandonByStep.length === 0 ? (
              <p className="text-sm text-slate-500">No drop-offs recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {b.abandonByStep.map((x) => (
                  <div key={x.step} className="grid grid-cols-[110px_1fr_50px] items-center gap-3 text-sm" onMouseMove={(e) => showTip(e, `${STEP_LABEL[x.step]}: ${x.count} left here`)} onMouseLeave={hideTip}>
                    <span className="text-slate-600">{STEP_LABEL[x.step]}</span>
                    <div className="h-5">
                      <div className="h-5" style={{ width: `${(x.count / abandonMax) * 100}%`, background: C1, borderRadius: "0 4px 4px 0" }} />
                    </div>
                    <span className="text-right tabular-nums text-slate-700">{x.count}</span>
                  </div>
                ))}
              </div>
            )}
            {b.orderErrors.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">Order form errors: {b.orderErrors.map((e) => `${e.reason} ${e.count}`).join(", ")}</p>
            )}
          </Card>

          {/* Product mix */}
          <Card title="Product mix" subtitle="Recommended in quotes vs. actually ordered">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr><th className="py-1 font-medium">Product</th><th className="text-right font-medium">Quoted</th><th className="text-right font-medium">Ordered</th><th className="text-right font-medium">Order rate</th></tr>
              </thead>
              <tbody>
                {s.productMix.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-1.5">{p.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</td>
                    <td className="text-right tabular-nums">{p.quoted}</td>
                    <td className="text-right tabular-nums">{p.ordered}</td>
                    <td className="text-right tabular-nums text-slate-500">{pct(p.quoted ? p.ordered / p.quoted : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="About this data" subtitle="Privacy by design">
            <ul className="space-y-1.5 text-sm text-slate-600">
              <li>• <strong>Service metrics</strong> (quotes, orders, AI decisions, timings) come from every quote, with no names, addresses, item descriptions or session links.</li>
              <li>• <strong>Behaviour metrics</strong> (funnel, time per step, edit clicks, drop-off) come only from the {b.sessions} sessions that allowed statistics, using a random per-tab id.</li>
              <li>• Visitors who choose &ldquo;Only necessary&rdquo; send nothing, so we don&apos;t count declines either.</li>
              <li>• Events are deleted after 13 months; the server drops any property not on the allow-list.</li>
            </ul>
          </Card>
        </div>
      </main>

      {tip && (
        <div className="pointer-events-none fixed z-50 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div className={`rounded-xl bg-white p-4 shadow-sm ${hero ? "ring-2 ring-brand/20" : ""}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 font-bold tabular-nums text-slate-900 ${hero ? "text-3xl" : "text-2xl"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-[11px] leading-tight text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-4 text-xs text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
      {items.map(([l, c]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="mt-3 text-xs text-slate-500">
      <summary className="cursor-pointer hover:text-brand">Show as table</summary>
      <table className="mt-2 w-full">
        <thead>
          <tr>{head.map((h) => <th key={h} className="py-1 text-left font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-1 tabular-nums">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
