import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

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

  const url = new URL(req.url);
  const weekStart = url.searchParams.get("weekStart");
  if (!weekStart) {
    return NextResponse.json({ error: "missing_weekStart" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("weekly_cache")
    .select("sessions, last_synced_at")
    .eq("athlete_id", athleteId)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "cache_fetch_failed", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    cached: Boolean(data),
    sessions: data?.sessions ?? [],
    lastSyncedAt: data?.last_synced_at ?? null,
  });
}

export async function POST(req: Request) {
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

  const body = await req.json();
  const weekStart = body?.weekStart;
  const sessions = body?.sessions;

  if (!weekStart || !Array.isArray(sessions)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("weekly_cache").upsert({
    athlete_id: athleteId,
    week_start: weekStart,
    sessions,
    last_synced_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json(
      { error: "cache_save_failed", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}