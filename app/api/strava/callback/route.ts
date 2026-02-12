import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";

    if (!code) return NextResponse.json({ error: "missing_code", state }, { status: 400 });

    const client_id = process.env.STRAVA_CLIENT_ID;
    const client_secret = process.env.STRAVA_CLIENT_SECRET;
    const redirect_uri = process.env.STRAVA_REDIRECT_URI;

    if (!client_id || !client_secret || !redirect_uri) {
      return NextResponse.json(
        { error: "missing_env", client_id: Boolean(client_id), client_secret: Boolean(client_secret), redirect_uri },
        { status: 500 }
      );
    }

    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id,
        client_secret,
        code,
        grant_type: "authorization_code",
        redirect_uri,
      }).toString(),
    });

    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return NextResponse.json({ error: "token_exchange_failed", status: tokenRes.status, body: tokenText }, { status: 500 });
    }

    const token = JSON.parse(tokenText) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: { firstname?: string; lastname?: string };
    };

    const athleteName =
      [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ").trim() || "Strava";

    // ✅ Always redirect using request URL base (works on Vercel + local)
    const redirectUrl = new URL("/", req.url);
    redirectUrl.searchParams.set("strava_connected", "1");
    redirectUrl.searchParams.set("athlete", athleteName);

    const res = NextResponse.redirect(redirectUrl);

    // ✅ Store EVERYTHING in the cookie your /me route expects
    res.cookies.set(
      "strava_tokens",
      JSON.stringify({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
        athlete: token.athlete,
      }),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        // optional but nice: keep cookie around for a while
        maxAge: 60 * 60 * 24 * 30, // 30 days
      }
    );

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: "callback_crash", message: e?.message || String(e) }, { status: 500 });
  }
}
