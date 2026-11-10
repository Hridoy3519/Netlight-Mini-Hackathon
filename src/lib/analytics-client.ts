// Browser-side analytics. GDPR / ePrivacy: nothing is sent unless the visitor
// has opted in to statistics. Events carry an anonymous per-visit id (kept in
// sessionStorage, gone when the tab closes) and never any personal data.

import type { EventName, EventProps } from "./analytics-schema";

const CONSENT_KEY = "nopea_consent_v1";
const SID_KEY = "nopea_sid";

export interface ConsentState {
  statistics: boolean;
  decidedAt: string;
}

export function getConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw ? (JSON.parse(raw) as ConsentState) : null;
  } catch {
    return null;
  }
}

export function setConsent(statistics: boolean) {
  const c: ConsentState = { statistics, decidedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(c));
    if (!statistics) sessionStorage.removeItem(SID_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent("nopea-consent", { detail: c }));
}

function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track<N extends EventName>(name: N, props: EventProps[N] = {} as EventProps[N]) {
  if (typeof window === "undefined" || !getConsent()?.statistics) return;
  const sid = sessionId();
  if (!sid) return;
  const body = JSON.stringify({ sid, name, props });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    else fetch("/api/events", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
  } catch {}
}
