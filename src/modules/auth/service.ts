import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../../db/pool';
import { config } from '../../config';
import { HttpError } from '../../lib/httpError';

// OWASP-recommended argon2id parameters
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface AuthContext {
  userId: string;
  plan: string;
  subject: string; // rate-limit bucket: 'key:<id>' or 'user:<id>'
}

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');


export function signJwt(userId: string, plan: string): string {
  return jwt.sign({ sub: userId, plan }, config.JWT_SECRET, { expiresIn: '7d' });
  // Tradeoff: plan is denormalized into the token — plan changes take effect
  // on next login (≤7d). Avoids a DB read per request. Fine for this design.
}

export async function registerUser(email: string, password: string) {
  const passwordHash = await argon2.hash(password, ARGON2_OPTS);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, plan, created_at`,
      [email.toLowerCase(), passwordHash],
    );
    return rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'Email already registered');
    }
    throw err;
  }
}

export async function loginUser(email: string, password: string) {
  const { rows } = await pool.query<{
    id: string; email: string; plan: string; password_hash: string | null;
  }>(`SELECT id, email, plan, password_hash FROM users WHERE email = $1`, [email.toLowerCase()]);

  const user = rows[0];
  // Identical error for unknown email and wrong password — don't leak which accounts exist.
  if (!user?.password_hash) throw new HttpError(401, 'Invalid email or password');
  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) throw new HttpError(401, 'Invalid email or password');

  return { user: { id: user.id, email: user.email, plan: user.plan }, token: signJwt(user.id, user.plan) };
}

export async function createApiKey(userId: string, name: string) {
  // 24 random bytes → ~32 url-safe chars. 'us_' prefix for easy secret scanning.
  const raw = `us_${randomBytes(24).toString('base64url')}`;
  const { rows } = await pool.query(
    `INSERT INTO api_keys (user_id, name, key_hash, prefix)
     VALUES ($1, $2, $3, $4) RETURNING id, name, prefix`,
    [userId, name, sha256(raw), raw.slice(0, 8)],
  );
  return { ...rows[0], key: raw }; // plaintext returned EXACTLY once — only the hash is stored
}

export async function authenticateApiKey(rawKey: string): Promise<AuthContext | null> {
  const { rows } = await pool.query<{
    id: string; user_id: string; plan: string; revoked_at: Date | null;
  }>(
    `SELECT k.id, k.user_id, u.plan, k.revoked_at
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1`,
    [sha256(rawKey)],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;

  void pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
  return { userId: row.user_id, plan: row.plan, subject: `key:${row.id}` };
}

export function verifyJwt(token: string): AuthContext | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { sub?: string; plan?: string };
    if (!payload.sub) return null;
    return { userId: payload.sub, plan: payload.plan ?? 'free', subject: `user:${payload.sub}` };
  } catch {
    return null;
  }
}