"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getConsent, setConsent, track } from "@/lib/analytics-client";

/**
 * GDPR / ePrivacy consent. Only strictly necessary storage is used by default.
 * Statistics are opt-in, and declining is exactly as easy as accepting.
 */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<boolean | null>(null);

  useEffect(() => {
    const c = getConsent();
    // Reading browser storage has to happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!c) setOpen(true);
    else setCurrent(c.statistics);
    const reopen = () => {
      setCurrent(getConsent()?.statistics ?? null);
      setOpen(true);
    };
    window.addEventListener("nopea-open-consent", reopen);
    return () => window.removeEventListener("nopea-open-consent", reopen);
  }, []);

  if (!open) return null;

  const decide = (statistics: boolean) => {
    setConsent(statistics);
    setCurrent(statistics);
    setOpen(false);
    if (statistics) track("session_start", { entry: location.pathname === "/" ? "home" : location.pathname.startsWith("/quote") ? "quote" : "other" });
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4" role="dialog" aria-labelledby="consent-title" aria-live="polite">
      <div className="pop mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 id="consent-title" className="font-semibold">Your privacy, your choice 🍪</h2>
        <p className="mt-1 text-sm text-slate-600">
          We only use what&apos;s strictly necessary to make quotes and orders work. With your permission, we&apos;d also collect
          <strong> anonymous usage statistics</strong> (like which steps people find hard). No names, no advertising, no tracking across other sites.
          You can change this any time via &ldquo;Cookie settings&rdquo;.{" "}
          <Link href="/privacy#cookies" className="underline">Learn more</Link>
        </p>
        {current !== null && <p className="mt-1 text-xs text-slate-500">Current choice: {current ? "statistics allowed" : "only necessary"}</p>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={() => decide(false)} className="rounded-xl border-2 border-brand px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand/5">
            Only necessary
          </button>
          <button onClick={() => decide(true)} className="rounded-xl border-2 border-brand bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
            Allow statistics
          </button>
        </div>
      </div>
    </div>
  );
}
