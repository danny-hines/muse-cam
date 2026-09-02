import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "musecam_admin";
const SESSION_SECONDS = 60 * 60 * 12;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectedKeyHash(): string | null {
  if (process.env.ADMIN_KEY_SHA256) return process.env.ADMIN_KEY_SHA256.toLowerCase();
  return process.env.ADMIN_KEY ? digest(process.env.ADMIN_KEY) : null;
}

function sessionSecret(): string | null {
  return process.env.ADMIN_SESSION_SECRET ?? null;
}

function equalHex(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function signature(expires: string, secret: string): string {
  return createHmac("sha256", secret).update(`musecam-admin:${expires}`).digest("hex");
}

export function adminAuthIsConfigured(): boolean {
  return Boolean(expectedKeyHash() && sessionSecret());
}

export function verifyAdminKey(key: string): boolean {
  const expected = expectedKeyHash();
  return Boolean(expected && key && equalHex(digest(key), expected));
}

export async function createAdminSession(): Promise<void> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Admin authentication is not configured");
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const value = `${expires}.${signature(expires, secret)}`;
  (await cookies()).set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const secret = sessionSecret();
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!secret || !value) return false;
  const [expires, actual, extra] = value.split(".");
  if (!expires || !actual || extra || Number(expires) <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  return equalHex(actual, signature(expires, secret));
}
