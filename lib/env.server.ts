import 'server-only';

import { z } from 'zod';

/**
 * Server-only environment variables.
 *
 * This module is protected by the `server-only` package: importing it from a
 * client component will fail the build, guaranteeing that server secrets are
 * never bundled into browser code.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),
  API_SECRET_KEY: z.string().min(1),
  REVALIDATE_SECRET: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    })
    .join('\n');
}

function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const invalidKeys = Array.from(
      new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)')),
    );

    throw new Error(
      `Invalid server environment variables:\n${formatIssues(parsed.error)}\n` +
        `Invalid keys: ${invalidKeys.join(', ')}`,
    );
  }

  return parsed.data;
}

/**
 * Validated, typed server-only configuration.
 * Fails fast at startup/build time with the list of invalid keys.
 */
export const serverEnv: ServerEnv = loadServerEnv();

export default serverEnv;
