import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { config, isProd } from './config';
import healthRoutes from './modules/health/routes';
import authRoutes from './modules/auth/routes';
import urlRoutes from './modules/urls/routes';
import redirectRoutes from './modules/redirect/routes';
import { HttpError } from './lib/httpError';

export async function buildApp(opts: Record<string, unknown> = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd
      ? { level: config.LOG_LEVEL }
      : { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } },
    trustProxy: true,
    ...opts,
  });

  // Fastify v5 infers `err` as unknown — annotate it explicitly.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err, 'Unhandled error');
    return reply.code(status).send({
      error: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  app.get('/', async () => ({ name: 'url-shortener', status: 'running' }));

  // Demo dashboard at /app/ — isolated prefix so it can't collide with
  // the API routes or the GET /:code redirect catch-all.
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/app/',
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(urlRoutes);
  await app.register(redirectRoutes);

  return app;
}