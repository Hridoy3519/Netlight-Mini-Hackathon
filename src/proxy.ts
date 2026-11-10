import { NextResponse, type NextRequest } from "next/server";

// GDPR: the specialist console, tickets and analytics show personal data, so
// they're staff-only. Simple HTTP Basic auth for the demo - use SSO in production.
export function proxy(req: NextRequest) {
  const user = process.env.AGENT_USER || "nopea";
  const pass = process.env.AGENT_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "demo");
  if (!pass) return new NextResponse("Console disabled: set AGENT_PASSWORD", { status: 503 });

  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [u, ...rest] = atob(encoded).split(":");
    if (u === user && rest.join(":") === pass) return NextResponse.next();
  }
  return new NextResponse("Staff login required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Nopea staff", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/agent/:path*", "/api/tickets/:path*", "/api/analytics/:path*"],
};
