import type { NextRequest } from "next/server";
import { getConversation } from "@/lib/store";
import { aiEnabled } from "@/lib/analyze";


export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ mode: aiEnabled() ? "ai" : "mock" });
  const c = getConversation(id);
  if (!c) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(c);
}
