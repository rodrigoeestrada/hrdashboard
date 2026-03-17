import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSessionToken, COOKIE_NAME } from "@/lib/session";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const scope = url.searchParams.get("scope") || "";

    if (!code) {
      return NextResponse.json({ error: "missing_code" }, { status: 400 });
    }

    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.STRAVA_CLIENT_ID!,
        client_secret: process.env.STRAVA_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.STRAVA_REDIRECT_URI!,
      }).toString(),
    });

    const tokenText = await tokenRes.text();

    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: "token_exchange_failed", status: tokenRes.status, body: tokenText },
        { status: 500 }
      );
    }

    const token = JSON.parse(tokenText) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: {
        id?: number;
        firstname?: string;
        lastname?: string;
        profile_medium?: string;
      };
    };

    const athleteId = token.athlete?.id;
    if (!athleteId) {
      return NextResponse.json({ error: "missing_athlete_id" }, { status: 500 });
    }

    const sb = supabaseAdmin();

    const { error: athleteError } = await sb.from("athletes").upsert({
      athlete_id: athleteId,
      firstname: token.athlete?.firstname ?? null,
      lastname: token.athlete?.lastname ?? null,
      profile_medium: token.athlete?.profile_medium ?? null,
    });

    if (athleteError) {
      return NextResponse.json(
        { error: "athlete_upsert_failed", details: athleteError.message },
        { status: 500 }
      );
    }

    const { error: tokenError } = await sb.from("strava_tokens").upsert({
      athlete_id: athleteId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_at,
      scope,
    });

    if (tokenError) {
      return NextResponse.json(
        { error: "token_upsert_failed", details: tokenError.message },
        { status: 500 }
      );
    }

    const sessionToken = await createSessionToken({
      athleteId,
      firstname: token.athlete?.firstname ?? null,
      lastname: token.athlete?.lastname ?? null,
    });

    const redirectUrl = new URL("/", req.url);
    redirectUrl.searchParams.set("strava_connected", "1");
    redirectUrl.searchParams.set(
      "athlete",
      [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(" ") || "Strava"
    );

    const res = NextResponse.redirect(redirectUrl);

    res.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: "callback_crash", message: e?.message || String(e) },
      { status: 500 }
    );
  }
}