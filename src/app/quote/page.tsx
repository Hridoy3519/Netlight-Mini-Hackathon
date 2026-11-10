"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VAT_LABEL } from "@/lib/catalog";
import type { Address, Answers, Conversation, Order, Selection, Shipment, Source } from "@/lib/types";
import type { AssessResult } from "@/lib/service";
import type { StepName } from "@/lib/analytics-schema";
import { track } from "@/lib/analytics-client";
import { ConfidencePanel } from "@/components/ConfidencePanel";
import { RichText } from "@/components/RichText";
import { Logo } from "@/components/Logo";

const eur = (n: number) => `€${n.toFixed(2)}`;

const STEPS = ["Your item", "Photo & link", "Speed", "Details", "Your quote", "Order"] as const;
const STEP_KEYS: StepName[] = ["item", "extras", "speed", "details", "quote", "address", "done"];

/** When this visit's quote flow started (for time-to-quote / time-to-order). */
let flowStart = Date.now();
const sinceStart = () => Date.now() - flowStart;

const EMPTY_ANSWERS: Answers = {
  description: "",
  link: "",
  fromPostcode: "",
  toPostcode: "",
  urgency: "balanced",
  alreadyPacked: "unsure",
  fragile: "unsure",
  weightKg: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  valueEur: null,
  parcels: 1,
};

const EMPTY_ADDRESS: Address = { name: "", street: "", postcode: "", city: "", email: "", phone: "" };

/** Re-encoding through a canvas shrinks the photo and strips EXIF metadata (GPS location, camera serial). */
async function resizeImage(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error ?? "Something went wrong"), { status: r.status });
  return d as T;
}

// ---------------------------------------------------------------------------

export default function QuotePage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [photo, setPhoto] = useState<{ dataUrl: string; name: string } | null>(null);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [subStep, setSubStep] = useState<"quote" | "address">("quote");

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setAnswers((a) => ({ ...a, [k]: v }));

  // ---- analytics: step views, time per step, abandonment
  const stepKey: StepName = order ? "done" : step <= 3 ? STEP_KEYS[step] : subStep;
  const stepEnteredAt = useRef(0); // set when each step is shown
  const currentStep = useRef<StepName>("item");
  useEffect(() => {
    flowStart = Date.now();
    track("session_start", { entry: document.referrer.includes(location.host) ? "home" : "other" });
    const onHide = () => {
      if (currentStep.current !== "done") track("abandon", { step: currentStep.current, msSinceStart: sinceStart() });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  useEffect(() => {
    const prev = currentStep.current;
    if (prev !== stepKey) track("step_done", { step: prev, ms: Date.now() - stepEnteredAt.current });
    currentStep.current = stepKey;
    stepEnteredAt.current = Date.now();
    track("step_view", { step: stepKey });
  }, [stepKey]);

  const canNext = step === 0 ? answers.description.trim().length >= 2 : true;

  async function run() {
    setStep(4);
    setThinking(true);
    setError(null);
    track("quote_requested", {
      photo: Boolean(photo),
      link: Boolean(answers.link.trim()),
      description: Boolean(answers.description.trim()),
      weight: answers.weightKg != null,
      size: Boolean(answers.lengthCm && answers.widthCm && answers.heightCm),
    });
    try {
      const [r] = await Promise.all([
        post<AssessResult>("/api/assess", { answers, imageDataUrl: photo?.dataUrl, imageName: photo?.name }),
        new Promise((res) => setTimeout(res, 2200)), // let the thinking steps play out
      ]);
      setResult(r);
      track("quote_shown", {
        msSinceStart: sinceStart(),
        decision: r.confidence.decision,
        confidence: Math.round(r.confidence.overall * 100) / 100,
        delegatedParts: r.confidence.delegatedParts.length,
        priceDelegated: r.confidence.delegatedParts.includes("price"),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep(3);
    } finally {
      setThinking(false);
    }
  }

  function restart() {
    setAnswers(EMPTY_ANSWERS);
    setPhoto(null);
    setResult(null);
    setOrder(null);
    setError(null);
    setSubStep("quote");
    setStep(0);
    flowStart = Date.now();
  }

  const progressStep = order ? 5 : step === 4 && subStep === "address" ? 5 : step;
  const nextLabel = step === 3 ? "Get my quote ✨" : step === 1 && !photo && !answers.link.trim() ? "Skip for now →" : "Continue →";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          {step > 0 && !order && (
            <button onClick={restart} className="text-sm text-slate-500 hover:text-brand">Start over</button>
          )}
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3">
          <ol className="flex gap-1.5" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className="flex-1" aria-current={i === progressStep ? "step" : undefined}>
                <div className={`h-1.5 rounded-full ${i <= progressStep ? "bg-brand" : "bg-slate-200"}`} />
                <div className={`mt-1 hidden text-[11px] sm:block ${i === progressStep ? "font-semibold text-brand" : "text-slate-400"}`}>{s}</div>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {step <= 3 && (
          <div className="pop mx-auto max-w-2xl" key={step}>
            {step === 0 && <StepItem answers={answers} set={set} />}
            {step === 1 && <StepExtras answers={answers} set={set} photo={photo} setPhoto={setPhoto} />}
            {step === 2 && <StepSpeed answers={answers} set={set} />}
            {step === 3 && <StepDetails answers={answers} set={set} />}
            {error && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className={`rounded-lg px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 ${step === 0 ? "invisible" : ""}`}
              >
                ← Back
              </button>
              <button
                disabled={!canNext}
                onClick={() => (step === 3 ? run() : setStep(step + 1))}
                className="rounded-xl bg-brand px-6 py-3 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-40"
              >
                {nextLabel}
              </button>
            </div>
          </div>
        )}

        {step === 4 && thinking && <Thinking hasPhoto={!!photo} hasLink={!!answers.link.trim()} />}
        {step === 4 && !thinking && result && !order && (
          <Review
            result={result}
            setResult={setResult}
            answers={answers}
            photo={photo}
            onSubStep={setSubStep}
            onDeleted={restart}
            onOrdered={(o) => {
              track("order_placed", { status: o.status, msSinceStart: sinceStart() });
              setOrder(o);
              setStep(5);
            }}
          />
        )}
        {step === 5 && order && <Confirmation order={order} setOrder={setOrder} onRestart={restart} />}
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        Quotes are prepared by AI and checked by our team when the AI is unsure. ·{" "}
        <Link href="/privacy" className="underline hover:text-brand">Privacy</Link> ·{" "}
        <button onClick={() => window.dispatchEvent(new Event("nopea-open-consent"))} className="underline hover:text-brand">Cookie settings</button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guided questionnaire

/** A friendly guide message at the top of each step - guidance, not a chat. */
function Guide({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white shadow-sm" aria-hidden>N</span>
      <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-700 shadow-sm">{children}</div>
    </div>
  );
}

function Question({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {hint && <p className="mt-2 text-slate-500">{hint}</p>}
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

type SetFn = <K extends keyof Answers>(k: K, v: Answers[K]) => void;

const EXAMPLES = ["A pair of shoes", "Two paperback books", "A ceramic vase", "A laptop", "A wooden chair"];

function StepItem({ answers, set }: { answers: Answers; set: SetFn }) {
  return (
    <>
      <Guide>
        Hei! 👋 I&apos;m here to help you send a parcel anywhere in Finland. It only takes a minute. First things first:
        <strong> what are you sending?</strong>
      </Guide>
      <Question title="What would you like to send?" hint="A few words is enough. Tell us what it is, and the size or material if you know.">
        <textarea
          autoFocus
          value={answers.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          maxLength={600}
          placeholder="e.g. A ceramic vase, about 40 cm tall"
          className="w-full rounded-xl border border-slate-200 bg-white p-4 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => set("description", e)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-brand hover:text-brand">
              {e}
            </button>
          ))}
        </div>
      </Question>
    </>
  );
}

function PermissionDialog({ title, points, confirm, onConfirm, onCancel }: { title: string; points: string[]; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="perm-title">
      <div className="pop w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="perm-title" className="text-lg font-bold">{title}</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          {points.map((p) => (
            <li key={p} className="flex gap-2"><span className="text-brand">✓</span><span>{p}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Read more in our <Link href="/privacy" target="_blank" className="underline">privacy notice</Link>. You can change your mind at any time.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium hover:bg-slate-50">No thanks</button>
          <button ref={ref} onClick={onConfirm} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">{confirm}</button>
        </div>
      </div>
    </div>
  );
}

const PHOTO_POINTS = [
  "We only use the photo to estimate your item's size and weight.",
  "It's analysed by our AI service provider and is never used to train AI models.",
  "Location and camera details are removed on your device before upload.",
  "It's deleted automatically after 30 days.",
  "Please make sure no people, faces or documents with personal details are visible.",
];
const LINK_POINTS = [
  "We'll open that page once to read the product's name, size and weight.",
  "We only keep the details needed for your quote, not the page itself.",
];

function StepExtras({ answers, set, photo, setPhoto }: { answers: Answers; set: SetFn; photo: { dataUrl: string; name: string } | null; setPhoto: (p: { dataUrl: string; name: string } | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState<"photo" | "link" | null>(null);
  const [linkAllowed, setLinkAllowed] = useState(Boolean(answers.link));
  const linkValid = !answers.link.trim() || /^https?:\/\/\S+\.\S+/.test(answers.link.trim());
  const closeAsk = useCallback(() => {
    if (ask) track(ask === "photo" ? "photo_permission" : "link_permission", { granted: false });
    setAsk(null);
  }, [ask]);

  return (
    <>
      <Guide>
        Thanks! Would you like to <strong>show me the item?</strong> A link to the product or a photo helps me get the size and weight right, so your price is more accurate.
        It&apos;s completely optional, and I&apos;ll ask for your permission first.
      </Guide>
      <Question title="Add a product link or photo">
        <div className="grid gap-3 sm:grid-cols-2">
          {linkAllowed ? (
            <div className="rounded-xl border-2 border-brand/40 bg-white p-3">
              <label className="text-sm font-medium" htmlFor="plink">🔗 Product link</label>
              <input
                id="plink"
                autoFocus
                type="url"
                value={answers.link}
                onChange={(e) => set("link", e.target.value)}
                onBlur={() => answers.link.trim() && linkValid && track("link_added", {})}
                placeholder="https://shop.example.fi/product…"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-brand"
              />
              {!linkValid && <div className="mt-1 text-xs text-rose-600">That doesn&apos;t look like a web address. It should start with https://</div>}
              <button onClick={() => { set("link", ""); setLinkAllowed(false); }} className="mt-1 text-xs text-slate-400 hover:text-slate-700">Remove link</button>
            </div>
          ) : (
            <button onClick={() => setAsk("link")} className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 text-left hover:border-brand">
              <span className="text-3xl">🔗</span>
              <span>
                <span className="block font-semibold">Paste a product link</span>
                <span className="text-sm text-slate-500">From any web shop. We read the size and weight</span>
              </span>
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setPhoto({ dataUrl: await resizeImage(f), name: f.name });
                track("photo_added", {});
              }
              e.target.value = "";
            }}
          />
          {photo ? (
            <div className="flex items-center gap-3 rounded-xl border-2 border-brand/40 bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.dataUrl} alt="Your item" className="h-16 w-16 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">📷 {photo.name}</div>
                <div className="text-xs text-slate-500">Location data removed ✓</div>
              </div>
              <button onClick={() => setPhoto(null)} className="px-2 text-xl text-slate-400 hover:text-slate-700" aria-label="Remove photo">×</button>
            </div>
          ) : (
            <button onClick={() => setAsk("photo")} className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 text-left hover:border-brand">
              <span className="text-3xl">📷</span>
              <span>
                <span className="block font-semibold">Add a photo</span>
                <span className="text-sm text-slate-500">Snap or upload a picture of the item</span>
              </span>
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500">No link or photo? No problem. Just press <em>Skip for now</em>.</p>
      </Question>

      {ask === "photo" && (
        <PermissionDialog
          title="May we use a photo of your item?"
          points={PHOTO_POINTS}
          confirm="Allow & choose photo"
          onCancel={closeAsk}
          onConfirm={() => {
            track("photo_permission", { granted: true });
            setAsk(null);
            fileRef.current?.click();
          }}
        />
      )}
      {ask === "link" && (
        <PermissionDialog
          title="May we read the product page?"
          points={LINK_POINTS}
          confirm="Allow"
          onCancel={closeAsk}
          onConfirm={() => {
            track("link_permission", { granted: true });
            setAsk(null);
            setLinkAllowed(true);
          }}
        />
      )}
    </>
  );
}


function Choice({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon?: string; title: string; text?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl border-2 bg-white p-4 text-left transition ${active ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300"}`}
    >
      {icon && <span className="text-2xl">{icon}</span>}
      <span>
        <span className="block font-semibold">{title}</span>
        {text && <span className="text-sm text-slate-500">{text}</span>}
      </span>
    </button>
  );
}

function StepSpeed({ answers, set }: { answers: Answers; set: SetFn }) {
  return (
    <>
      <Guide>Got it! We deliver <strong>everywhere in Finland</strong> 🇫🇮. What matters most to you? I&apos;ll recommend the option that fits, and show you the alternatives too.</Guide>
      <Question title="What matters most?">
        <div className="grid gap-3 sm:grid-cols-3">
          <Choice active={answers.urgency === "cheapest"} onClick={() => set("urgency", "cheapest")} icon="💰" title="Lowest price" text="I'm not in a hurry" />
          <Choice active={answers.urgency === "balanced"} onClick={() => set("urgency", "balanced")} icon="⚖️" title="Best value" text="Reliable and tracked" />
          <Choice active={answers.urgency === "fastest"} onClick={() => set("urgency", "fastest")} icon="⚡" title="Fastest" text="Next business day" />
        </div>
      </Question>
    </>
  );
}

function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`rounded-full border px-4 py-2 text-sm ${value === v ? "border-brand bg-brand text-white" : "border-slate-200 bg-white hover:border-slate-300"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function NumInput({ value, onChange, placeholder, suffix, label }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; suffix?: string; label?: string }) {
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value.replace(",", ".");
          onChange(v === "" ? null : Number.isFinite(+v) ? +v : value);
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white p-3 pr-10 outline-none focus:border-brand"
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-3 text-sm text-slate-400">{suffix}</span>}
    </div>
  );
}

function StepDetails({ answers, set }: { answers: Answers; set: SetFn }) {
  return (
    <>
      <Guide>
        Almost done! Just a few quick details. <strong>Skip anything you&apos;re not sure about</strong>: I&apos;ll estimate it, and a colleague double-checks if I&apos;m unsure.
      </Guide>
      <Question title="A few quick details">
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">Is it already packed?</div>
          <Pills value={answers.alreadyPacked} onChange={(v) => set("alreadyPacked", v)} options={[["yes", "Yes, it's packed"], ["no", "No, I need packaging"], ["unsure", "Not sure"]]} />
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">Is it fragile?</div>
          <Pills value={answers.fragile} onChange={(v) => set("fragile", v)} options={[["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">Weight (optional)</span>
            <NumInput value={answers.weightKg} onChange={(v) => set("weightKg", v)} placeholder="e.g. 4" suffix="kg" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">Value (optional, for insurance)</span>
            <NumInput value={answers.valueEur} onChange={(v) => set("valueEur", v)} placeholder="e.g. 250" suffix="€" />
          </label>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-600">Size (optional) · length × width × height</span>
          <div className="grid grid-cols-3 gap-2">
            <NumInput label="Length" value={answers.lengthCm} onChange={(v) => set("lengthCm", v)} placeholder="L" suffix="cm" />
            <NumInput label="Width" value={answers.widthCm} onChange={(v) => set("widthCm", v)} placeholder="W" suffix="cm" />
            <NumInput label="Height" value={answers.heightCm} onChange={(v) => set("heightCm", v)} placeholder="H" suffix="cm" />
          </div>
        </div>
        <label className="block max-w-40">
          <span className="mb-1 block text-sm font-medium text-slate-600">Number of parcels</span>
          <NumInput value={answers.parcels} onChange={(v) => set("parcels", Math.max(1, Math.round(v ?? 1)))} />
        </label>
      </Question>
    </>
  );
}

// ---------------------------------------------------------------------------

function Thinking({ hasPhoto, hasLink }: { hasPhoto: boolean; hasLink: boolean }) {
  const steps = useMemo(
    () => [
      ...(hasLink ? ["Reading the product page"] : []),
      ...(hasPhoto ? ["Looking at your photo"] : []),
      "Understanding what you're shipping",
      "Choosing the best product",
      "Picking the right packaging",
      "Calculating your price",
      "Checking our shipping rules",
    ],
    [hasPhoto, hasLink],
  );
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 420);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="pop mx-auto max-w-md rounded-2xl bg-white p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
        <h2 className="text-xl font-bold">Preparing your quote…</h2>
      </div>
      <ul className="mt-6 space-y-3">
        {steps.map((s, k) => (
          <li key={s} className={`flex items-center gap-3 text-sm transition ${k <= i ? "text-slate-800" : "text-slate-300"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${k < i ? "bg-emerald-500 text-white" : k === i ? "border-2 border-brand" : "border-2 border-slate-200"}`}>
              {k < i ? "✓" : ""}
            </span>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review: AI-filled order form, with Edit and Place order

const SOURCE_BADGE: Record<Source, { label: string; cls: string } | null> = {
  customer_stated: null,
  product_page: { label: "From product page", cls: "bg-sky-50 text-sky-700" },
  page_text: { label: "From product page", cls: "bg-sky-50 text-sky-700" },
  image_estimate: { label: "Estimated from photo", cls: "bg-amber-50 text-amber-800" },
  inferred: { label: "AI estimate", cls: "bg-amber-50 text-amber-800" },
  unknown: { label: "Not known", cls: "bg-slate-100 text-slate-500" },
};

type Draft = {
  contents: string;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  declared_value_eur: number | null;
  parcel_count: number;
  urgency: "cheapest" | "balanced" | "fastest";
  is_fragile: boolean;
};

const draftFrom = (s: Shipment): Draft => ({
  contents: s.contents.value ?? "",
  weight_kg: s.weight_kg.value,
  length_cm: s.length_cm.value,
  width_cm: s.width_cm.value,
  height_cm: s.height_cm.value,
  declared_value_eur: s.declared_value_eur.value,
  parcel_count: s.parcel_count.value ?? 1,
  urgency: s.urgency.value ?? "balanced",
  is_fragile: s.is_fragile,
});

const selectionFrom = (r: AssessResult): Selection => ({
  productId: r.quote?.recommended?.productId ?? null,
  addOnIds: r.quote?.addOns.filter((a) => a.selected).map((a) => a.id) ?? null,
  packagingIds: r.quote?.packaging.filter((p) => p.selected).map((p) => p.id) ?? null,
});

function Review({ result, setResult, answers, photo, onOrdered, onSubStep, onDeleted }: { result: AssessResult; setResult: (r: AssessResult) => void; answers: Answers; photo: { dataUrl: string } | null; onOrdered: (o: Order) => void; onSubStep: (s: "quote" | "address") => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(result.shipment));
  const [sel, setSel] = useState<Selection>(() => selectionFrom(result));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [specialist, setSpecialist] = useState<{ name: string; text: string } | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(result.confirmedTotal);

  const q = result.quote;
  const s = result.shipment;
  const pricePending = result.confidence.delegatedParts.includes("price") && confirmedTotal == null;
  const needsReview = result.confidence.decision === "delegate" && !specialist;

  // Wait for the specialist's answer while a part is delegated.
  useEffect(() => {
    if (!result.ticketId) return;
    const shownAt = Date.now();
    const t = setInterval(async () => {
      const r = await fetch(`/api/conversation?id=${result.conversationId}`);
      if (!r.ok) return;
      const c = (await r.json()) as Conversation;
      const h = [...c.messages].reverse().find((m) => m.role === "human" && m.ticketId === result.ticketId);
      if (h) {
        track("specialist_reply_seen", { waitMs: Date.now() - shownAt });
        setSpecialist({ name: h.agentName ?? "Specialist", text: h.text });
        setConfirmedTotal(c.confirmedTotal ?? null);
        clearInterval(t);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [result.ticketId, result.conversationId]);

  async function deleteQuote() {
    if (!confirm("Delete this quote and any photo you shared? This can't be undone.")) return;
    try {
      await post("/api/privacy", { action: "delete_quote", conversationId: result.conversationId });
      track("quote_deleted", {});
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const before = draftFrom(s);
    const edits: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof Draft)[]) if (draft[k] !== before[k]) edits[k] = draft[k];
    try {
      const r = await post<AssessResult>("/api/quote", { conversationId: result.conversationId, edits, selection: sel });
      const prevSel = selectionFrom(result);
      track("edit_saved", {
        fieldsChanged: Object.keys(edits).length,
        selectionChanged: JSON.stringify(prevSel) !== JSON.stringify(sel),
        before: result.confidence.decision,
        after: r.confidence.decision,
      });
      setResult(r);
      setSel(selectionFrom(r));
      setDraft(draftFrom(r.shipment));
      setConfirmedTotal(r.confirmedTotal);
      if (r.ticketId !== result.ticketId) setSpecialist(null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    track("edit_cancelled", {});
    setDraft(draftFrom(s));
    setSel(selectionFrom(result));
    setEditing(false);
    setError(null);
  }

  const toggle = (key: "addOnIds" | "packagingIds", id: string) =>
    setSel((x) => {
      const cur = new Set(x[key] ?? []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      return { ...x, [key]: [...cur] };
    });

  const startEdit = (from: "summary" | "section") => {
    track("edit_clicked", { from });
    setEditing(true);
  };
  const D = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const total = confirmedTotal ?? q?.grandTotal ?? null;

  if (placing) {
    return <AddressStep result={result} answers={answers} selection={sel} total={total} onBack={() => { setPlacing(false); onSubStep("quote"); }} onOrdered={onOrdered} pricePending={pricePending || needsReview} />;
  }

  return (
    <div className="pop grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <div className="rounded-2xl border border-brand/20 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-lg">✨</span>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand">Here&apos;s what we prepared for you</div>
              <div className="space-y-1 text-sm text-slate-700"><RichText text={result.note} /></div>
              <ConfidencePanel report={result.confidence} />
            </div>
          </div>
          {result.ticketId && !specialist && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
              </span>
              A specialist is checking this now. You can edit details meanwhile (an exact weight often settles it instantly), or place the order and we&apos;ll confirm before pickup.
            </div>
          )}
          {specialist && (
            <div className="pop mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] text-white">{specialist.name[0]}</span>
                {specialist.name} · Nopea specialist
              </div>
              <RichText text={specialist.text} />
              {confirmedTotal != null && <div className="mt-2 font-semibold text-indigo-900">Confirmed price: {eur(confirmedTotal)}</div>}
            </div>
          )}
        </div>

        {/* Shipment details */}
        <Section title="Your shipment" action={!editing && <EditButton onClick={() => startEdit("section")} />}>
          {photo && !editing && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.dataUrl} alt="Your item" className="mb-3 h-24 rounded-lg border border-slate-200 object-cover" />
          )}
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What are you shipping?" wide>
                <input value={draft.contents} onChange={(e) => D("contents", e.target.value)} className="inp" />
              </Field>
              <Field label="Weight (kg)"><NumInput value={draft.weight_kg} onChange={(v) => D("weight_kg", v)} suffix="kg" /></Field>
              <Field label="Value (€)"><NumInput value={draft.declared_value_eur} onChange={(v) => D("declared_value_eur", v)} suffix="€" /></Field>
              <Field label="Size L × W × H (cm), item before packing" wide>
                <div className="grid grid-cols-3 gap-2">
                  <NumInput value={draft.length_cm} onChange={(v) => D("length_cm", v)} suffix="cm" />
                  <NumInput value={draft.width_cm} onChange={(v) => D("width_cm", v)} suffix="cm" />
                  <NumInput value={draft.height_cm} onChange={(v) => D("height_cm", v)} suffix="cm" />
                </div>
              </Field>
              <Field label="Parcels"><NumInput value={draft.parcel_count} onChange={(v) => D("parcel_count", Math.max(1, Math.round(v ?? 1)))} /></Field>
              <Field label="Fragile">
                <Pills value={draft.is_fragile ? "yes" : "no"} onChange={(v) => D("is_fragile", v === "yes")} options={[["yes", "Yes"], ["no", "No"]]} />
              </Field>
              <Field label="Speed" wide>
                <Pills value={draft.urgency} onChange={(v) => D("urgency", v)} options={[["cheapest", "Lowest price"], ["balanced", "Best value"], ["fastest", "Fastest"]]} />
              </Field>
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row hidePct={result.confidenceFloor != null} label="Contents" f={s.contents} />
              <Row label="Route" value="Within Finland 🇫🇮" />
              <Row hidePct={result.confidenceFloor != null} label="Weight" f={s.weight_kg} value={s.weight_kg.value != null ? `${s.weight_kg.value} kg` : null} />
              <Row
                hidePct={result.confidenceFloor != null}
                label="Size (item)"
                f={[s.length_cm, s.width_cm, s.height_cm].reduce((a, b) => (b.confidence < a.confidence ? b : a))}
                value={s.length_cm.value && s.width_cm.value && s.height_cm.value ? `${s.length_cm.value} × ${s.width_cm.value} × ${s.height_cm.value} cm` : null}
              />
              <Row hidePct={result.confidenceFloor != null} label="Value" f={s.declared_value_eur} value={s.declared_value_eur.value != null ? eur(s.declared_value_eur.value) : null} />
              <Row label="Parcels · fragile" value={`${s.parcel_count.value ?? 1} · ${s.is_fragile ? "fragile" : "not fragile"}`} />
            </dl>
          )}
        </Section>

        {/* Product */}
        {q && (
          <Section title="Shipping product" action={!editing && <EditButton onClick={() => startEdit("section")} />}>
            <div className="space-y-2">
              {(editing ? q.options : q.options.filter((o) => o.productId === (sel.productId ?? q.recommended?.productId))).map((o) => {
                const active = o.productId === (sel.productId ?? q.recommended?.productId);
                return (
                  <label key={o.productId} className={`flex items-center gap-3 rounded-xl border-2 p-3 ${active ? "border-brand bg-brand/5" : "border-slate-200"} ${editing ? "cursor-pointer" : ""}`}>
                    {editing && <input type="radio" checked={active} onChange={() => setSel((x) => ({ ...x, productId: o.productId }))} className="accent-[var(--brand)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        {o.productName}
                        {o.productId === q.recommendedId && <span className="rounded bg-accent/20 px-1.5 py-px text-[10px] font-bold uppercase text-amber-800">Recommended</span>}
                      </div>
                      <div className="text-xs text-slate-500">{o.tagline} · {o.transit}</div>
                    </div>
                    <div className="text-right font-semibold tabular-nums">{pricePending && o.range ? `${eur(o.range.low)}–${eur(o.range.high)}` : eur(o.totalIncVat)}</div>
                  </label>
                );
              })}
              {editing && <p className="text-xs text-slate-400">Prices update when you save. They depend on the packed size and weight.</p>}
            </div>
          </Section>
        )}

        {/* Packaging */}
        {q && (
          <Section title="Packaging" action={!editing && <EditButton onClick={() => startEdit("section")} />}>
            {result.packagingNote && <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm italic text-slate-600">💡 {result.packagingNote}</p>}
            <ExtrasList items={q.packaging} selected={sel.packagingIds ?? []} editing={editing} onToggle={(id) => toggle("packagingIds", id)} empty="No packaging selected. Use Edit to add a box or protection." />
          </Section>
        )}

        {/* Add-ons */}
        {q && (
          <Section title="Extras" action={!editing && <EditButton onClick={() => startEdit("section")} />}>
            <ExtrasList items={q.addOns} selected={sel.addOnIds ?? []} editing={editing} onToggle={(id) => toggle("addOnIds", id)} empty="No extras selected." />
          </Section>
        )}

        {!q && (
          <Section title="Quote">
            <p className="text-sm text-slate-600">
              This item needs a specialist&apos;s review before we can price it. You can still place the order: we&apos;ll confirm the price and whether we can accept it before anything is charged.
            </p>
          </Section>
        )}
      </div>

      {/* Summary */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Order summary</h2>
          {q?.recommended ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex justify-between gap-2"><span>{q.recommended.productName}</span><span className="tabular-nums">{eur(q.recommended.totalIncVat)}</span></li>
              {[...q.packaging, ...q.addOns].filter((x) => x.selected).map((x) => (
                <li key={x.id} className="flex justify-between gap-2 text-slate-600"><span>{x.name}</span><span className="tabular-nums">{eur(x.price)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Price to be confirmed by a specialist.</p>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">{confirmedTotal != null ? "Confirmed total" : pricePending ? "Estimated total" : "Total"}</span>
              <span className="text-2xl font-bold tabular-nums">
                {total == null ? "—" : pricePending && q?.grandRange ? `${eur(q.grandRange.low)}–${eur(q.grandRange.high)}` : eur(total)}
              </span>
            </div>
            <div className="text-right text-[11px] text-slate-400">{VAT_LABEL}</div>
          </div>
          {q && (
            <ul className="mt-3 space-y-0.5 text-[11px] text-slate-500">
              {q.customsNote && <li>• Customs declaration needed for this route</li>}
              <li>• Transit times are estimates, not guarantees</li>
              <li>• Quote valid 24 h; final price confirmed at drop-off if size or weight differ</li>
            </ul>
          )}
          {error && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            {editing ? (
              <>
                <button onClick={cancel} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={save} disabled={saving} className="rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                  {saving ? "Updating…" : "Save changes"}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => startEdit("summary")} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">✏️ Edit</button>
                <button onClick={() => { track("place_order_clicked", { decision: result.confidence.decision }); setPlacing(true); onSubStep("address"); }} className="rounded-xl bg-accent px-4 py-3 text-sm font-bold text-slate-900 shadow-sm hover:brightness-105">Place order</button>
              </>
            )}
          </div>
          {!editing && (pricePending || needsReview) && (
            <p className="mt-2 text-center text-[11px] text-slate-500">You won&apos;t be charged until a specialist confirms the price.</p>
          )}
        </div>
        <div className="mt-3 space-y-1 px-2 text-center text-[11px] text-slate-400">
          <p>🤖 Prepared by AI from your answers{photo ? " and photo" : ""}. Our team checks anything the AI isn&apos;t sure about.</p>
          <button onClick={deleteQuote} className="underline hover:text-rose-600">Delete this quote and my photo</button>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="text-sm font-medium text-brand hover:underline">Edit</button>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, f, value, hidePct }: { label: string; f?: { value: unknown; confidence: number; source: Source }; value?: string | null; hidePct?: boolean }) {
  const shown = value !== undefined ? value : f?.value != null ? String(f.value) : null;
  const badge = f ? (shown == null ? SOURCE_BADGE.unknown : SOURCE_BADGE[f.source]) : null;
  const low = !hidePct && f && shown != null && f.source !== "customer_stated" && f.confidence < 0.6;
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span className={`font-medium ${shown == null ? "text-slate-400" : ""}`}>{shown ?? "Not provided"}</span>
        {badge && (
          <span className={`rounded px-1.5 py-px text-[10px] font-medium ${low ? "bg-rose-50 text-rose-700" : badge.cls}`}>
            {badge.label}
            {!hidePct && shown != null && f && f.source !== "customer_stated" ? ` · ${Math.round(f.confidence * 100)}%` : ""}
          </span>
        )}
      </dd>
    </div>
  );
}

function ExtrasList({ items, selected, editing, onToggle, empty }: { items: { id: string; name: string; description: string; price: number; suggested: boolean; reason?: string }[]; selected: string[]; editing: boolean; onToggle: (id: string) => void; empty: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const chosen = items.filter((i) => selected.includes(i.id));
  if (!editing) {
    if (!chosen.length) return <p className="text-sm text-slate-500">{empty}</p>;
    return (
      <ul className="space-y-2">
        {chosen.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <div className="font-medium">{i.name} {i.suggested && <span className="ml-1 rounded bg-accent/20 px-1.5 py-px text-[10px] font-bold uppercase text-amber-800">Suggested</span>}</div>
              <div className="text-xs text-slate-500">{i.reason ?? i.description}</div>
            </div>
            <span className="tabular-nums">{eur(i.price)}</span>
          </li>
        ))}
      </ul>
    );
  }
  const primary = items.filter((i) => i.suggested || selected.includes(i.id));
  const rest = items.filter((i) => !primary.includes(i));
  const list = showAll ? [...primary, ...rest] : primary;
  return (
    <div className="space-y-2">
      {list.map((i) => (
        <label key={i.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-2.5 text-sm hover:bg-slate-50">
          <input type="checkbox" checked={selected.includes(i.id)} onChange={() => onToggle(i.id)} className="mt-1 accent-[var(--brand)]" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{i.name} {i.suggested && <span className="ml-1 rounded bg-accent/20 px-1.5 py-px text-[10px] font-bold uppercase text-amber-800">Suggested</span>}</div>
            <div className="text-xs text-slate-500">{i.reason ?? i.description}</div>
          </div>
          <span className="tabular-nums">{eur(i.price)}</span>
        </label>
      ))}
      {rest.length > 0 && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="text-xs font-medium text-brand hover:underline">
          {showAll ? "Show fewer" : `Show all options (${rest.length} more)`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddressStep({ result, answers, selection, total, pricePending, onBack, onOrdered }: { result: AssessResult; answers: Answers; selection: Selection; total: number | null; pricePending: boolean; onBack: () => void; onOrdered: (o: Order) => void }) {
  const [sender, setSender] = useState<Address>({ ...EMPTY_ADDRESS, postcode: answers.fromPostcode });
  const [recipient, setRecipient] = useState<Address>({ ...EMPTY_ADDRESS, postcode: answers.toPostcode });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { order } = await post<{ order: Order }>("/api/orders", { conversationId: result.conversationId, selection, sender, recipient });
      onOrdered(order);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const msg = e instanceof Error ? e.message : "";
      track("order_error", { reason: status === 400 ? (/can't accept/.test(msg) ? "prohibited" : "validation") : "server" });
      setError(msg || "Could not place the order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pop mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold sm:text-3xl">Who&apos;s sending and receiving?</h1>
      <p className="mt-2 text-slate-500">Last step! We&apos;ll email the shipping label and tracking link to the sender.</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <AddressForm title="Sender · Finland" value={sender} onChange={setSender} withEmail />
        <AddressForm title="Recipient · Finland" value={recipient} onChange={setRecipient} />
      </div>
      <label className="mt-5 flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
        <span>
          I&apos;ve read the <Link href="/privacy" target="_blank" className="underline">privacy notice</Link>. We use these details only to deliver this parcel
          and send the label and tracking updates. The recipient&apos;s details are shared only with the delivering courier.
        </span>
      </label>
      {error && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="mt-8 flex items-center justify-between">
        <button onClick={onBack} className="rounded-lg px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100">← Back to quote</button>
        <button onClick={submit} disabled={busy || !agree} className="rounded-xl bg-accent px-6 py-3 font-bold text-slate-900 shadow-sm hover:brightness-105 disabled:opacity-50">
          {busy ? "Placing order…" : pricePending ? "Place order (price confirmed before pickup)" : `Confirm & place order${total != null ? ` · ${eur(total)}` : ""}`}
        </button>
      </div>
    </div>
  );
}

function AddressForm({ title, value, onChange, withEmail }: { title: string; value: Address; onChange: (a: Address) => void; withEmail?: boolean }) {
  const f = (k: keyof Address, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input value={value[k] ?? ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} className="inp" {...props} />
    </label>
  );
  return (
    <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      {f("name", "Full name", { autoComplete: "name" })}
      {f("street", "Street address", { autoComplete: "street-address" })}
      <div className="grid grid-cols-[110px_1fr] gap-2">
        {f("postcode", "Postcode", { autoComplete: "postal-code" })}
        {f("city", "City", { autoComplete: "address-level2" })}
      </div>
      {withEmail ? f("email", "Email", { type: "email", autoComplete: "email" }) : f("phone", "Phone (optional)", { type: "tel" })}
    </div>
  );
}

function Confirmation({ order, setOrder, onRestart }: { order: Order; setOrder: (o: Order) => void; onRestart: () => void }) {
  // While pending review, watch for the specialist's confirmation.
  useEffect(() => {
    if (order.status !== "pending_review") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/orders?conversationId=${order.conversationId}`);
      const d = (await r.json()) as { orders: Order[] };
      const o = d.orders.find((x) => x.id === order.id);
      if (o && o.status !== order.status) setOrder(o);
    }, 3000);
    return () => clearInterval(t);
  }, [order, setOrder]);

  const ok = order.status === "confirmed";
  return (
    <div className="pop mx-auto max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl ${ok ? "bg-emerald-100 text-emerald-600" : "bg-indigo-100 text-indigo-600"}`}>{ok ? "✓" : "⏳"}</div>
      <h1 className="mt-4 text-2xl font-bold">{ok ? "Order confirmed!" : "Order received"}</h1>
      <p className="mt-2 text-slate-600">
        {ok
          ? `We've emailed your shipping label to ${order.sender.email}.`
          : "A specialist is confirming the final details. You'll get the label by email once it's approved, and nothing is charged before that."}
      </p>
      <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Order number</span><span className="font-mono font-semibold">{order.id}</span></div>
        <div className="mt-1 flex justify-between"><span className="text-slate-500">Product</span><span>{order.productName}</span></div>
        <div className="mt-1 flex justify-between"><span className="text-slate-500">To</span><span>{order.recipient.name}, {order.recipient.city}</span></div>
        <div className="mt-1 flex justify-between"><span className="text-slate-500">{ok ? "Total" : "Estimated total"}</span><span className="font-semibold">{order.total ? eur(order.total) : "To be confirmed"}</span></div>
        <div className="mt-1 flex justify-between"><span className="text-slate-500">Status</span><span className={ok ? "text-emerald-600" : "text-indigo-600"}>{ok ? "Confirmed" : "Awaiting specialist"}</span></div>
      </div>
      <button onClick={onRestart} className="mt-6 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium hover:bg-slate-50">Ship something else</button>
    </div>
  );
}
