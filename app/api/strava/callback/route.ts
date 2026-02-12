import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    // Strava sometimes returns empty state if you didn't send one — don't crash on it.
    const state = url.searchParams.get("state") || "";

    if (!code) {
      return NextResponse.json({ error: "missing_code", state }, { status: 400 });
    }

    const client_id = process.env.STRAVA_CLIENT_ID;
    const client_secret = process.env.STRAVA_CLIENT_SECRET;
    const redirect_uri = process.env.STRAVA_REDIRECT_URI;

    if (!client_id || !client_secret || !redirect_uri) {
      return NextResponse.json(
        { error: "missing_env", client_id: Boolean(client_id), client_secret: Boolean(client_secret), redirect_uri },
        { status: 500 }
      );
    }

    // Exchange code -> token
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
      // This is the KEY: you’ll actually see Strava’s error message now.
      return NextResponse.json(
        { error: "token_exchange_failed", status: tokenRes.status, body: tokenText },
        { status: 500 }
      );
    }

    const token = JSON.parse(tokenText) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: { firstname?: string; lastname?: string };
    };

    const athleteName = [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ").trim();

    const res = NextResponse.redirect(
      new URL(`/?strava_connected=1&athlete=${encodeURIComponent(athleteName || "Strava")}`, req.url)
    );

    // Store tokens in httpOnly cookies
    res.cookies.set("strava_access_token", token.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    res.cookies.set("strava_refresh_token", token.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    res.cookies.set("strava_expires_at", String(token.expires_at), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: "callback_crash", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}
