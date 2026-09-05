import type { AuthContext } from '../modules/auth/service';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}