import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { getValidStravaAccessToken } from "@/lib/strava";

export async function GET(req: Request) {
  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  if (!raw) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  let athleteId: number;
  try {
    const session = await verifySessionToken(raw);
    athleteId = session.athleteId;
  } catch {
    return NextResponse.json({ error: "invalid_session" }, { status: 401 });
  }

  const access = await getValidStravaAccessToken(athleteId);
  if (!access) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const url = new URL(req.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const stravaUrl = new URL("https://www.strava.com/api/v3/athlete/activities");
  if (after) stravaUrl.searchParams.set("after", after);
  if (before) stravaUrl.searchParams.set("before", before);
  stravaUrl.searchParams.set("per_page", "200");

  const r = await fetch(stravaUrl.toString(), {
    headers: { Authorization: `Bearer ${access}` },
    cache: "no-store",
  });

  const text = await r.text();
  if (!r.ok) {
    return NextResponse.json({ error: "strava_failed", status: r.status, body: text }, { status: r.status });
  }

  return NextResponse.json(JSON.parse(text));
}