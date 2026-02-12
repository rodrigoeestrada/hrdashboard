import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.redirect(`${process.env.APP_URL}/?strava_error=1`);
  if (!code) return NextResponse.redirect(`${process.env.APP_URL}/?strava_error=1`);

  const client_id = process.env.STRAVA_CLIENT_ID!;
  const client_secret = process.env.STRAVA_CLIENT_SECRET!;

  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id,
      client_secret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${process.env.APP_URL}/?strava_error=1`);
  }

  const tokenJson = await tokenRes.json();
  // tokenJson includes: access_token, refresh_token, expires_at, athlete
  const res = NextResponse.redirect(
    `${process.env.APP_URL}/?strava_connected=1&athlete=${encodeURIComponent(tokenJson.athlete?.firstname || "Strava")}`
  );

  // Minimal approach: store tokens in an HttpOnly cookie (good enough for personal use)
  res.cookies.set("strava_tokens", JSON.stringify({
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_at: tokenJson.expires_at,
    athlete: tokenJson.athlete,
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return res;
}
