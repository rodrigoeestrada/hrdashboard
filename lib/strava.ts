import { supabaseAdmin } from "@/lib/supabaseAdmin";

type StravaTokenRow = {
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
};

export async function getValidStravaAccessToken(athleteId: number) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("strava_tokens")
    .select("athlete_id, access_token, refresh_token, expires_at, scope")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as StravaTokenRow;
  const now = Math.floor(Date.now() / 1000);

  if (row.expires_at > now + 60) {
    return row.access_token;
  }

  const refreshRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }).toString(),
  });

  const refreshText = await refreshRes.text();
  if (!refreshRes.ok) {
    throw new Error(`Strava refresh failed: ${refreshText}`);
  }

  const refreshed = JSON.parse(refreshText) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope?: string;
  };

  const { error: updateError } = await sb
    .from("strava_tokens")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: refreshed.expires_at,
      scope: refreshed.scope ?? row.scope,
    })
    .eq("athlete_id", athleteId);

  if (updateError) {
    throw new Error(`Supabase token update failed: ${updateError.message}`);
  }

  return refreshed.access_token;
}