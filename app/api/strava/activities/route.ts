import { NextResponse } from "next/server";
import { cookies } from "next/headers";

async function getAccessToken() {
  const c = await cookies();
  const raw = c.get("strava_tokens")?.value;
  if (!raw) return null;
  const tok = JSON.parse(raw);
  return tok.access_token as string;
}

export async function GET(req: Request) {
  const access = await getAccessToken();
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

  if (!r.ok) return NextResponse.json({ error: "strava_failed" }, { status: r.status });
  const data = await r.json();
  return NextResponse.json(data);
}
