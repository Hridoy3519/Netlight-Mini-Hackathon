"use client";

import { useState } from "react";

/** Self-service GDPR requests: access/portability (export) and erasure. */
export function DataRequestForm() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go(action: "export" | "delete") {
    if (action === "delete" && !confirm("Erase your personal data for this order? This can't be undone.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/privacy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, orderId, email }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (action === "export") {
        const blob = new Blob([JSON.stringify(d.data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `nopea-data-${orderId.trim().toUpperCase()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        setMsg({ ok: true, text: "Your data has been downloaded as a JSON file." });
      } else {
        setMsg({ ok: true, text: "Done. Your personal data has been erased. We keep only the non-personal bookkeeping record the law requires." });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="not-prose rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Order number</span>
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="NP-XXXXXX" className="inp" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Sender email used for the order</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="inp" />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => go("export")} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Download my data</button>
        <button disabled={busy} onClick={() => go("delete")} className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Erase my data</button>
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
      <p className="mt-3 text-xs text-slate-500">For anything else (correcting data, objecting, or questions), email privacy@nopea.example. We reply within one month.</p>
    </div>
  );
}
