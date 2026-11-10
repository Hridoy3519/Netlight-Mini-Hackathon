import { addDemoEvents, clearDemoEvents, listEvents } from "@/lib/store";
import { computeMetrics } from "@/lib/metrics";
import { generateDemoTraffic } from "@/lib/demo-seed";

// Staff only (protected in proxy.ts).
export async function GET(req: Request) {
  const days = Math.min(395, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 30));
  const events = listEvents();
  return Response.json({ metrics: computeMetrics(events, days), demoEvents: events.filter((e) => e.demo).length, totalEvents: events.length });
}

export async function POST(req: Request) {
  const { action } = (await req.json()) as { action?: string };
  if (action === "seed_demo") return Response.json({ added: addDemoEvents(generateDemoTraffic()) });
  if (action === "clear_demo") return Response.json({ removed: clearDemoEvents() });
  return Response.json({ error: "unknown action" }, { status: 400 });
}
