import { placeOrder, UserError } from "@/lib/service";
import { listOrders } from "@/lib/store";
import type { Address, Selection } from "@/lib/types";

export async function GET(req: Request) {
  // Customers can only see orders for their own quote (its id is a long random key).
  const id = new URL(req.url).searchParams.get("conversationId");
  if (!id) return Response.json({ error: "conversationId required" }, { status: 400 });
  return Response.json({ orders: listOrders().filter((o) => o.conversationId === id) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { conversationId: string; selection: Selection; sender: Address; recipient: Address };
  try {
    return Response.json({ order: await placeOrder(body.conversationId, body.selection, body.sender, body.recipient) });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error("order failed", e);
    return Response.json({ error: "Couldn't place the order. Please try again." }, { status: 502 });
  }
}
