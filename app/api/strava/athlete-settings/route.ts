import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function GET() {
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

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("athlete_settings")
    .select("z2_low, z3_low, z4_low, z5_low")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "settings_fetch_failed", details: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ hrZones: null });
  }

  return NextResponse.json({
    hrZones: {
      z2Low: data.z2_low,
      z3Low: data.z3_low,
      z4Low: data.z4_low,
      z5Low: data.z5_low,
    },
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
  const hrZones = body?.hrZones;

  if (
    !hrZones ||
    typeof hrZones.z2Low !== "number" ||
    typeof hrZones.z3Low !== "number" ||
    typeof hrZones.z4Low !== "number" ||
    typeof hrZones.z5Low !== "number"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("athlete_settings").upsert({
    athlete_id: athleteId,
    z2_low: hrZones.z2Low,
    z3_low: hrZones.z3Low,
    z4_low: hrZones.z4Low,
    z5_low: hrZones.z5Low,
  });

  if (error) {
    return NextResponse.json({ error: "settings_save_failed", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}