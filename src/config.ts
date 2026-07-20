import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: booleanString,
  SESSION_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  DEMO_MODE: booleanString,
  TRUST_PROXY: booleanString,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Environment validation failed', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

const env = parsed.data;
const fallbackSecret = 'local-development-only-secret-change-me-now';

if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  baseUrl: env.APP_BASE_URL.replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  sessionSecret: env.SESSION_SECRET ?? fallbackSecret,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  googleAuthEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  demoMode: env.DEMO_MODE || !env.DATABASE_URL,
  trustProxy: env.TRUST_PROXY,
};
