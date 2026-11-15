import { z } from 'zod';

/** "a, b" → ["a", "b"]; empty → []. */
const urlList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^(stun|turns?):/, 'Must start with stun:, turn: or turns:')));

// [CONCEPT: Environment Configuration] Env vars are parsed once at startup; the process fails fast if one is missing or malformed.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().url().or(z.string().startsWith('mongodb')),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  RUNNER_URL: z.string().url().default('http://localhost:5050'),
  RUNNER_TOKEN: z.string().min(8),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Calls. STUN finds public addresses; TURN (coturn) relays media when no direct path works. TURN is optional in
  // development: without TURN_SECRET and TURN_URLS, calls only get STUN.
  STUN_URLS: urlList.default(['stun:stun.l.google.com:19302']),
  TURN_URLS: urlList.default([]),
  // The same value as coturn's static-auth-secret.
  TURN_SECRET: z.string().min(32).optional(),
  TURN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(4 * 3600),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
