import { assess, UserError } from "@/lib/service";
import type { Answers } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as { answers: Answers; imageDataUrl?: string; imageName?: string };
  if (body.imageDataUrl && body.imageDataUrl.length > 6_000_000) return Response.json({ error: "Photo is too large" }, { status: 400 });
  try {
    return Response.json(await assess(body.answers, body.imageDataUrl, body.imageName));
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error("assess failed", e);
    return Response.json({ error: "We couldn't prepare your quote right now. Please try again." }, { status: 502 });
  }
}
