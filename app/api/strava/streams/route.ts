import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(req: Request) {
  const c = await cookies();
  const raw = c.get("strava_tokens")?.value;
  if (!raw) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const tok = JSON.parse(raw);
  const access = tok.access_token as string;

  const url = new URL(req.url);
  const activityId = url.searchParams.get("activityId");
  if (!activityId) return NextResponse.json({ error: "missing_activityId" }, { status: 400 });

  // Ask for time + heartrate streams; key_by_type=true returns an object keyed by stream type
  const streamUrl =
    `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/streams` +
    `?keys=time,heartrate&key_by_type=true`;

  const r = await fetch(streamUrl, {
    headers: { Authorization: `Bearer ${access}` },
    cache: "no-store",
  });

  if (!r.ok) return NextResponse.json({ error: "strava_failed" }, { status: r.status });
  const data = await r.json();
  return NextResponse.json(data);
}
