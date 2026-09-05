import Fastify, { FastifyInstance } from 'fastify';
import { config, isProd } from './config';
import healthRoutes from './modules/health/routes';
import urlRoutes from './modules/urls/routes';
import redirectRoutes from './modules/redirect/routes';
import { HttpError } from './lib/httpError';
import authRoutes from './modules/auth/routes';

export async function buildApp(opts: Record<string, unknown> = {}): Promise<FastifyInstance> {
    
  const app = Fastify({
    logger: isProd
      ? { level: config.LOG_LEVEL }
      : { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } },
    trustProxy: true, 
    ...opts,          
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err, 'Unhandled error');
    return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  

  app.get('/', async () => ({ name: 'url-shortener', status: 'running' }));

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(urlRoutes);
  await app.register(redirectRoutes);
  await app.register(authRoutes, { prefix: '/auth' });

  return app;
}