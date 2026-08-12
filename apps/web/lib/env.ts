import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
