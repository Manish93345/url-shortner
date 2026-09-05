import { pool } from '../../db/pool';
import { idGenerator } from '../../services/idGenerator';
import { encodeBase62 } from '../../services/base62';

export interface ShortUrl {
  shortCode: string;
  originalUrl: string;
  createdAt: string;
}

// TEMPORARY (Phase 3 replaces this with real auth): all URLs owned by the
// seeded dev user until JWT/API keys exist.
let devUserId: string | null = null;
async function getDevUserId(): Promise<string> {
  if (!devUserId) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'dev@localhost'`,
    );
    devUserId = rows[0].id;
  }
  return devUserId;
}

export async function createShortUrl(originalUrl: string): Promise<ShortUrl> {
  const [id, userId] = await Promise.all([idGenerator.nextId(), getDevUserId()]);
  const shortCode = encodeBase62(id);

  const { rows } = await pool.query<{
    short_code: string;
    original_url: string;
    created_at: Date;
  }>(
    `INSERT INTO urls (id, short_code, original_url, user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING short_code, original_url, created_at`,
    [id.toString(), shortCode, originalUrl, userId], // BigInt → string for pg
  );

  const row = rows[0];
  return {
    shortCode: row.short_code,
    originalUrl: row.original_url,
    createdAt: row.created_at.toISOString(),
  };
}