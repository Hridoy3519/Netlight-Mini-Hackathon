"use client";

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button className={className} onClick={() => window.dispatchEvent(new Event("nopea-open-consent"))}>
      Cookie settings
    </button>
  );
}
