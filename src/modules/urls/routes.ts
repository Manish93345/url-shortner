import { FastifyPluginAsync } from 'fastify';
import { config } from '../../config';
import { createUrlSchema } from './schemas';
import { createShortUrl } from './service';

const urlRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/urls', async (req, reply) => {
    const parsed = createUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const shortUrl = await createShortUrl(parsed.data.url);

    return reply.code(201).send({
      ...shortUrl,
      shortUrl: `${config.BASE_URL}/${shortUrl.shortCode}`,
    });
  });
};

export default urlRoutes;