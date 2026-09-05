import 'dotenv/config'; 
import { z } from 'zod';


const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1).default('postgres://urlshort:urlshort@localhost:5432/urlshort'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-0123456789abcdef'),
  BASE_URL: z.string().default('http://localhost:3000'), // set to your domain in prod
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment config:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
// after parsed check:
if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.startsWith('dev-only')) {
  console.error('❌ Refusing to start: set a real JWT_SECRET (32+ chars) in production');
  process.exit(1);
}
export const isProd = config.NODE_ENV === 'production';
