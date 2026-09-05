import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApiKey, verifyJwt, type AuthContext } from './service';
import { checkRateLimit, limitForPlan } from '../../services/rateLimiter';
import { HttpError } from '../../lib/httpError';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Accepts X-API-Key or Authorization: Bearer. Throws 401 if neither is valid. */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;

  let auth: AuthContext | null = null;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    auth = await authenticateApiKey(apiKey);
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    auth = verifyJwt(authHeader.slice(7));
  }
  if (!auth) throw new HttpError(401, 'Missing or invalid credentials');
  req.auth = auth;
}

/** Sliding-window limiter, keyed per subject. Sets standard rate-limit headers. */
export async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = req.auth;
  if (!auth) return; // requireAuth always runs first

  const result = await checkRateLimit(auth.subject, limitForPlan(auth.plan));

  if (result.remaining >= 0) {
    reply.header('X-RateLimit-Limit', result.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
  }
  if (!result.allowed) {
    return reply
      .code(429)
      .header('Retry-After', String(result.retryAfterSec))
      .send({ error: 'Rate limit exceeded', retryAfterSec: result.retryAfterSec });
  }
}