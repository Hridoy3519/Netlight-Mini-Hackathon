import { appendMessage, getConversation, getTicket, listOrders, listTickets, newId, recordEvent, saveTicket, stats } from "@/lib/store";
import { onSpecialistResolved } from "@/lib/service";
import type { ChatMessage, QuoteResult } from "@/lib/types";
import { VAT } from "@/lib/catalog";


export async function GET(req: Request) {
  void req.url; // reading the request keeps this handler dynamic (never prerendered)
  const orders = listOrders();
  const tickets = listTickets().map((t) => ({
    ...t,
    conversation: getConversation(t.conversationId),
    orders: orders.filter((o) => o.conversationId === t.conversationId),
  }));
  return Response.json({ tickets, stats: stats() });
}

/** A human resolves a ticket: their reply (optionally with a confirmed price) goes straight into the customer's chat. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    ticketId: string;
    text: string;
    agentName?: string;
    confirmedTotal?: number | null;
    approveQuote?: boolean;
  };
  const t = getTicket(body.ticketId);
  if (!t) return Response.json({ error: "ticket not found" }, { status: 404 });
  if (t.status === "resolved") return Response.json({ error: "already resolved" }, { status: 409 });
  if (!body.text?.trim()) return Response.json({ error: "reply is required" }, { status: 400 });

  let quote: QuoteResult | null = null;
  if (t.quote?.recommended && (body.approveQuote || body.confirmedTotal != null)) {
    const rec = { ...t.quote.recommended };
    if (body.confirmedTotal != null && body.confirmedTotal > 0) {
      rec.totalIncVat = Math.round(body.confirmedTotal * 100) / 100;
      rec.totalExVat = Math.round((body.confirmedTotal / (1 + VAT)) * 100) / 100;
      rec.lines = [{ label: "Confirmed by specialist", amount: rec.totalExVat }];
    }
    delete rec.range;
    quote = { ...t.quote, recommended: rec, alternatives: [], grandTotal: body.confirmedTotal ?? t.quote.grandTotal, grandRange: undefined };
  }

  const agentName = body.agentName?.trim() || "Nopea specialist";
  const msg: ChatMessage = {
    id: newId("m"),
    role: "human",
    text: body.text.trim(),
    at: new Date().toISOString(),
    agentName,
    quote,
    ticketId: t.id,
  };
  appendMessage(t.conversationId, msg);
  saveTicket({ ...t, status: "resolved", resolvedAt: msg.at, resolution: msg.text, agentName });
  onSpecialistResolved(t.conversationId, quote ? quote.grandTotal : null);
  recordEvent("srv_ticket_resolved", { waitMs: Date.now() - new Date(t.createdAt).getTime(), withPrice: Boolean(quote) });
  return Response.json({ ok: true });
}
