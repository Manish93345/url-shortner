import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(50),
});