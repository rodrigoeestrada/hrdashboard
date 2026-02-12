import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const c = await cookies();
  const raw = c.get("strava_tokens")?.value;
  if (!raw) return NextResponse.json({ athleteName: null }, { status: 401 });

  const tok = JSON.parse(raw);
  const name = tok.athlete?.firstname ? `${tok.athlete.firstname}` : null;
  return NextResponse.json({ athleteName: name });
}
