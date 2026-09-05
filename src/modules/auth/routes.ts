import { FastifyPluginAsync } from 'fastify';
import { registerSchema, loginSchema, createApiKeySchema } from './schemas';
import { registerUser, loginUser, createApiKey, signJwt } from './service';
import { requireAuth } from './middleware';
import { validationError } from '../../lib/httpError';

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const user = await registerUser(parsed.data.email, parsed.data.password);
    return reply.code(201).send({
      user: { id: user.id, email: user.email, plan: user.plan },
      token: signJwt(user.id, user.plan),
    });
  });

  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    return reply.send(await loginUser(parsed.data.email, parsed.data.password));
  });

  app.post('/api-keys', { preHandler: [requireAuth] }, async (req, reply) => {
    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const created = await createApiKey(req.auth!.userId, parsed.data.name);
    return reply.code(201).send(created); // includes `key` — shown exactly once
  });
};

export default authRoutes;