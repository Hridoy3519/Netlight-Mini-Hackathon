// Reads a product page the customer links to and pulls out what matters for
// shipping: name, weight, dimensions, price. Structured data (JSON-LD) is
// preferred because it is far more reliable than free page text.

import dns from "node:dns/promises";
import net from "node:net";

export interface LinkInfo {
  url: string;
  ok: boolean;
  error?: string;
  title?: string;
  description?: string;
  structured?: Record<string, unknown>; // schema.org Product fields
  textExcerpt?: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) links are supported");
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error("That address isn't publicly reachable");
  return u;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

function meta(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i");
  const m = html.match(re) ?? html.match(re2);
  return m ? decode(m[1]) : undefined;
}

const PRODUCT_KEYS = ["name", "description", "weight", "width", "height", "depth", "size", "material", "category", "sku", "brand", "offers", "additionalProperty"];

function findProduct(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findProduct(n);
      if (f) return f;
    }
    return;
  }
  const o = node as Record<string, unknown>;
  const t = o["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) {
    const out: Record<string, unknown> = {};
    for (const k of PRODUCT_KEYS) if (o[k] != null) out[k] = o[k];
    return out;
  }
  for (const k of ["@graph", "mainEntity", "itemListElement"]) {
    const f = findProduct(o[k]);
    if (f) return f;
  }
}

export async function readLink(raw: string): Promise<LinkInfo> {
  try {
    let u = await assertPublicUrl(raw);
    let res: Response | null = null;
    // Follow redirects manually so each hop is checked.
    for (let i = 0; i < 4; i++) {
      res = await fetch(u, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; NopeaBot/1.0)", accept: "text/html" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        u = await assertPublicUrl(new URL(loc, u).toString());
        continue;
      }
      break;
    }
    if (!res || !res.ok) return { url: raw, ok: false, error: `Page returned ${res?.status ?? "no response"}` };
    const html = (await res.text()).slice(0, 1_500_000);

    let structured: Record<string, unknown> | undefined;
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        structured = findProduct(JSON.parse(m[1].trim()));
        if (structured) break;
      } catch {
        /* ignore malformed JSON-LD */
      }
    }

    const title = meta(html, "og:title") ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
    const description = meta(html, "og:description") ?? meta(html, "description");
    const text = decode(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    // Keep the parts of the page most likely to mention size/weight.
    const hits = [...text.matchAll(/.{0,120}(?:weight|vekt|kg|dimension|mål|size|cm|mm|inches|lbs)\b.{0,120}/gi)]
      .slice(0, 12)
      .map((m) => m[0]);
    const textExcerpt = (hits.length ? hits.join(" … ") : text.slice(0, 2000)).slice(0, 3000);

    return { url: u.toString(), ok: true, title, description, structured, textExcerpt };
  } catch (e) {
    return { url: raw, ok: false, error: e instanceof Error ? e.message : "Could not read the page" };
  }
}

export function linkInfoForPrompt(l: LinkInfo): string {
  if (!l.ok) return `The customer shared ${l.url} but it could not be read (${l.error}). Do not guess its contents.`;
  return [
    `Customer shared a product link: ${l.url}`,
    l.title && `Page title: ${l.title}`,
    l.description && `Description: ${l.description}`,
    l.structured && `Structured product data (source: product_page): ${JSON.stringify(l.structured).slice(0, 3000)}`,
    l.textExcerpt && `Page text excerpts (source: page_text): ${l.textExcerpt}`,
  ]
    .filter(Boolean)
    .join("\n");
}
