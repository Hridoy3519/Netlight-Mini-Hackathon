import { eraseOrderData, eraseQuote, exportOrderData } from "@/lib/store";

/**
 * GDPR data-subject requests.
 *  - export / delete: identify with order number + the sender email used on the order
 *  - delete_quote: delete an un-ordered quote from this browser (holds its random id)
 */
export async function POST(req: Request) {
  const b = (await req.json()) as { action?: string; orderId?: string; email?: string; conversationId?: string };
  if (b.action === "delete_quote" && b.conversationId) {
    const r = eraseQuote(b.conversationId);
    if (r === "has_order") return Response.json({ error: "This quote became an order - use the order number to manage it." }, { status: 409 });
    return Response.json({ ok: true });
  }
  const orderId = (b.orderId ?? "").trim().toUpperCase();
  const email = (b.email ?? "").trim();
  if (!orderId || !email) return Response.json({ error: "Please enter your order number and email." }, { status: 400 });
  // Same response for "no such order" and "wrong email", so order numbers can't be probed.
  const notFound = Response.json({ error: "We couldn't find an order with that number and email." }, { status: 404 });
  if (b.action === "export") {
    const data = exportOrderData(orderId, email);
    return data ? Response.json({ data }) : notFound;
  }
  if (b.action === "delete") {
    return eraseOrderData(orderId, email) ? Response.json({ ok: true }) : notFound;
  }
  return Response.json({ error: "Unknown request" }, { status: 400 });
}
