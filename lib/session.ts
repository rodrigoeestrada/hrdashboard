import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "app_session";

type SessionPayload = {
  athleteId: number;
  firstname?: string | null;
  lastname?: string | null;
};

function getSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error("Missing APP_SESSION_SECRET");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as SessionPayload;
}

export { COOKIE_NAME };
export type { SessionPayload };