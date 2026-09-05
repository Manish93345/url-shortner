import { z } from 'zod';

/** http/https only. A shortener that accepts javascript:/data: URLs is a
 *  phishing vector — we're redirecting real users, so scheme matters. */
export const createUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((raw) => {
      try {
        const parsed = new URL(raw);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'Must be a valid http(s) URL' }),
});