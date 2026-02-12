import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.STRAVA_CLIENT_ID!;
  const redirectUri = process.env.STRAVA_REDIRECT_URI!;
  const scope = "activity:read_all"; // get private activities too
  // Strava expects scopes as comma-delimited string
  const url =
    "https://www.strava.com/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&approval_prompt=auto` +
    `&scope=${encodeURIComponent(scope)}`;

  return NextResponse.json({ url });
}
