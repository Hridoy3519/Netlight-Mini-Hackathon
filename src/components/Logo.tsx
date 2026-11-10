import Link from "next/link";

/** Nopea ("fast" in Finnish) - a parcel with a speed mark. */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2 text-lg font-extrabold tracking-tight ${light ? "text-white" : "text-brand"}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect x="9" y="8" width="18" height="16" rx="3" fill="currentColor" />
        <path d="M18 8v6l-2-1.2-2 1.2V8" fill="var(--accent)" />
        <path d="M2 13h5M3.5 17.5h4M2 22h5" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      nopea
    </Link>
  );
}
