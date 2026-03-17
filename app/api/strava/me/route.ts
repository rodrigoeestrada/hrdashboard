import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function GET() {
  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  if (!raw) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  try {
    const session = await verifySessionToken(raw);
    return NextResponse.json({
      connected: true,
      athleteId: session.athleteId,
      athleteName: [session.firstname, session.lastname].filter(Boolean).join(" ") || "Strava",
    });
  } catch {
    return NextResponse.json({ error: "invalid_session" }, { status: 401 });
  }
}