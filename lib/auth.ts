import { getEnv } from "./env";

export const SESSION_COOKIE_NAME = "retrotube_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str: string): Uint8Array | null {
  try {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    const mod = padded.length % 4;
    const base64 = mod === 0 ? padded : padded + "=".repeat(4 - mod);
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    }
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function constantTimeEqualsBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(digest);
}

async function deriveSigningKey(password: string): Promise<CryptoKey> {
  const secretBytes = await sha256(`retrotube-session-key::${password}`);
  return globalThis.crypto.subtle.importKey(
    "raw",
    secretBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function isAuthEnabled(): boolean {
  return getEnv().APP_PASSWORD.length > 0;
}

export async function verifyAppPassword(candidate: string): Promise<boolean> {
  const configured = getEnv().APP_PASSWORD;
  if (!configured) return true;
  if (!candidate) return false;

  const [candidateHash, expectedHash] = await Promise.all([
    sha256(candidate),
    sha256(configured),
  ]);
  return constantTimeEqualsBytes(candidateHash, expectedHash);
}

export async function createSessionToken(nowMs = Date.now()): Promise<string> {
  const password = getEnv().APP_PASSWORD;
  const expiresAt = nowMs + SESSION_MAX_AGE_SEC * 1000;
  const payload = `v1.${expiresAt}`;
  const key = await deriveSigningKey(password);
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  nowMs = Date.now(),
): Promise<boolean> {
  const password = getEnv().APP_PASSWORD;
  if (!password) return true;
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [version, expiresRaw, sigB64] = parts;
  if (version !== "v1" || !expiresRaw || !sigB64) return false;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return false;
  }

  const sigBytes = fromBase64Url(sigB64);
  if (!sigBytes) return false;

  const payload = `${version}.${expiresRaw}`;
  const key = await deriveSigningKey(password);
  const expectedSig = new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
  return constantTimeEqualsBytes(sigBytes, expectedSig);
}

export function parseCookieValue(
  cookieHeader: string | null,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    if (name === cookieName) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}
