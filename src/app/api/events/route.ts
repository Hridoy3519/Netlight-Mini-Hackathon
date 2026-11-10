import { recordEvent } from "@/lib/store";
import { CLIENT_EVENTS } from "@/lib/analytics-schema";

/** Receives consented, anonymous analytics events from the browser. */
export async function POST(req: Request) {
  let body: { sid?: unknown; name?: unknown; props?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const sid = typeof body.sid === "string" && /^[0-9a-f-]{36}$/.test(body.sid) ? body.sid : null;
  const name = typeof body.name === "string" ? body.name : "";
  // Only client events from the allow-list; server-side events can't be forged.
  if (!sid || !(CLIENT_EVENTS as string[]).includes(name)) return new Response(null, { status: 400 });
  return new Response(null, { status: recordEvent(name, body.props, sid) ? 204 : 400 });
}
