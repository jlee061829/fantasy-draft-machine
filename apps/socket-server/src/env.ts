import { z } from "zod";

// Mirrors apps/web/lib/env.ts: fail loudly at boot rather than lazily at
// first use. This module must be the first thing src/index.ts imports —
// @fdm/database's Prisma client singleton reads process.env.DATABASE_URL at
// module-eval time, so a misconfigured environment needs to fail here,
// before that import happens, not inside the Prisma adapter.
const envSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(4000),
  SOCKET_CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
