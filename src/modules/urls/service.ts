import { pool } from '../../db/pool';
import { idGenerator } from '../../services/idGenerator';
import { encodeBase62 } from '../../services/base62';
import {redis} from '../../plugins/redis';

export interface ShortUrl {
  shortCode: string;
  originalUrl: string;
  createdAt: string;
}

export async function createShortUrl(originalUrl: string, userId: string): Promise<ShortUrl> {
  const id = await idGenerator.nextId();
  const shortCode = encodeBase62(id);

  const { rows } = await pool.query<{
    short_code: string;
    original_url: string;
    created_at: Date;
  }>(
    `INSERT INTO urls (id, short_code, original_url, user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING short_code, original_url, created_at`,
    [id.toString(), shortCode, originalUrl, userId],
  );
  

  const row = rows[0];
  return {
    shortCode: row.short_code,
    originalUrl: row.original_url,
    createdAt: row.created_at.toISOString(),
  };
}

export async function deleteShortUrl(code: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM urls WHERE short_code = $1 AND user_id = $2`,
    [code, userId],
  );
  if (!rowCount) return false;

  // Cache invalidation — without DEL, the cached entry keeps redirecting for
  // up to 24h: the classic "I deleted it but the link still works" bug.
  void redis.del(`url:${code}`).catch(() => {});
  void redis.del(`nf:${code}`).catch(() => {});
  void redis.hdel('stats:clicks', code).catch(() => {});
  return true;
}