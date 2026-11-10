import { reprice, UserError, type Edits } from "@/lib/service";
import type { Selection } from "@/lib/types";

export const maxDuration = 60;

/** Re-price after the customer edits the form. Deterministic unless the contents changed. */
export async function POST(req: Request) {
  const body = (await req.json()) as { conversationId: string; edits?: Edits; selection: Selection };
  try {
    return Response.json(await reprice(body.conversationId, body.edits ?? {}, body.selection));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error("reprice failed", e);
    return Response.json({ error: "Couldn't update the quote. Please try again." }, { status: 502 });
  }
}
