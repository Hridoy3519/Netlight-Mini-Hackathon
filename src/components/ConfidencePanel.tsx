"use client";

import { useState } from "react";
import type { ConfidenceReport, Level } from "@/lib/types";

const COLORS: Record<Level, { bar: string; chip: string }> = {
  high: { bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  medium: { bar: "bg-amber-400", chip: "bg-amber-50 text-amber-800 border-amber-200" },
  low: { bar: "bg-rose-500", chip: "bg-rose-50 text-rose-700 border-rose-200" },
};

export function ConfidencePanel({ report, defaultOpen = false }: { report: ConfidenceReport; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const c = COLORS[report.level];
  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${c.chip}`}
        aria-expanded={open}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${c.bar}`} />
        {Math.round(report.overall * 100)}% confident
        {report.delegatedParts.length > 0 && ` · ${report.delegatedParts.length} part${report.delegatedParts.length > 1 ? "s" : ""} sent to a human`}
        <span className="opacity-60">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="pop mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
          {report.parts.map((p) => (
            <div key={p.part}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">
                  {p.label}
                  {p.delegated && <span className="ml-1.5 rounded bg-indigo-50 px-1 py-px text-[10px] font-semibold text-indigo-700">HUMAN</span>}
                </span>
                <span className="tabular-nums text-slate-500">{Math.round(p.score * 100)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div className={`h-1.5 rounded-full ${COLORS[p.level].bar}`} style={{ width: `${Math.max(4, p.score * 100)}%` }} />
              </div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                {p.reasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
