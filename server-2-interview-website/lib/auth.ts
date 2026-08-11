/**
 * Auth utilities.
 *
 * Users are defined in AUTH_USERS env var (JSON array) or via the convenience
 * AUTH_ADMIN_* / AUTH_RECRUITER_* variables.  Passwords are plain-text for
 * now (acceptable for an internal tool — upgrade to bcrypt later if needed).
 *
 * AUTH_SECRET must be set to a random 32+ character string.
 *
 * Example .env.local:
 *
 *   AUTH_SECRET=change-me-to-a-long-random-string-32-chars
 *   AUTH_USERS=[{"username":"admin","password":"admin123","role":"admin"},{"username":"recruiter1","password":"pass123","role":"recruiter"}]
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { type Role, ROLE_PERMISSIONS } from "@/lib/rbac";

export type { Role };

export type AuthUser = {
  id: string;
  username: string;
  role: Role;
};

export type AuthPayload = JWTPayload & {
  id: string;
  username: string;
  role: Role;
};

const COOKIE_NAME = "ai-interview-auth";
const TOKEN_TTL   = "7d";

// ─── Secret ──────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is not set or too short (need 16+ chars). Add it to .env.local.");
  }
  return new TextEncoder().encode(s);
}

// ─── User store ───────────────────────────────────────────────────────

type RawUser = { username: string; password: string; role: string };

function loadUsers(): Array<RawUser & { id: string }> {
  const raw = process.env.AUTH_USERS;
  let users: RawUser[] = [];
  if (raw) {
    try { users = JSON.parse(raw) as RawUser[]; } catch { /* ignore */ }
  }
  return users.map((u, i) => ({ ...u, id: String(i + 1) }));
}

export function findUser(username: string, password: string): AuthUser | null {
  const users = loadUsers();
  const found = users.find(
    (u) => u.username === username && u.password === password
  );
  if (!found) return null;
  // Accept any role that exists in ROLE_PERMISSIONS.
  const validRoles = Object.keys(ROLE_PERMISSIONS) as Role[];
  const role = validRoles.includes(found.role as Role) ? (found.role as Role) : null;
  if (!role) return null;
  return { id: found.id, username: found.username, role };
}

// ─── Token ────────────────────────────────────────────────────────────

export async function createToken(user: AuthUser): Promise<string> {
  return new SignJWT({ id: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as AuthPayload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
