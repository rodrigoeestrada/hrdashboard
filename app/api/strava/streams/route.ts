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
  const activityId = url.searchParams.get("activityId");
  if (!activityId) {
    return NextResponse.json({ error: "missing_activityId" }, { status: 400 });
  }

  const streamUrl =
    `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/streams` +
    `?keys=time,heartrate&key_by_type=true`;

  const r = await fetch(streamUrl, {
    headers: { Authorization: `Bearer ${access}` },
    cache: "no-store",
  });

  const text = await r.text();
  if (!r.ok) {
    return NextResponse.json({ error: "strava_failed", status: r.status, body: text }, { status: r.status });
  }

  return NextResponse.json(JSON.parse(text));
}