import Fastify, { FastifyInstance } from 'fastify';
import { config, isProd } from './config';
import healthRoutes from './modules/health/routes';
import urlRoutes from './modules/urls/routes';
import redirectRoutes from './modules/redirect/routes';

export async function buildApp(opts: Record<string, unknown> = {}): Promise<FastifyInstance> {
    
  const app = Fastify({
    logger: isProd
      ? { level: config.LOG_LEVEL }
      : { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } },
    trustProxy: true, // we sit behind Nginx in prod — needed to read real client IPs
    ...opts,          // tests can override anything (e.g., logger: false)
  });

  

  app.get('/', async () => ({ name: 'url-shortener', status: 'running' }));

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(urlRoutes);
  await app.register(redirectRoutes);

  return app;
}