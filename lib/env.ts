import { z } from 'zod';

/**
 * Public (browser-safe) environment schema.
 *
 * Only `NEXT_PUBLIC_*` variables may live here — anything secret belongs in
 * `lib/env.server.ts`, which is guarded by `import 'server-only'`.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  NEXT_PUBLIC_NETWORK: z.enum(['mainnet', 'testnet', 'local']),
  NEXT_PUBLIC_CONTRACT_ID: z.string().min(1),
  NEXT_PUBLIC_EXPLORER_URL: z.string().url(),
  NEXT_PUBLIC_FEATURE_FLAGS: z
    .string()
    .optional()
    .transform((value) => parseFeatureFlags(value)),
});

/**
 * Parse a comma-separated `key:boolean` list into a typed record.
 * Defaults to an empty object when unset so feature checks stay safe.
 */
function parseFeatureFlags(value: string | undefined): Record<string, boolean> {
  if (!value) return {};

  return value.split(',').reduce<Record<string, boolean>>((flags, entry) => {
    const [rawKey, rawValue] = entry.split(':');
    const key = rawKey?.trim();
    if (!key) return flags;

    flags[key] = rawValue?.trim() === 'true';
    return flags;
  }, {});
}

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
  NEXT_PUBLIC_CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
  NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
  NEXT_PUBLIC_FEATURE_FLAGS: process.env.NEXT_PUBLIC_FEATURE_FLAGS,
});

if (!parsed.success) {
  const invalidKeys = Object.keys(parsed.error.flatten().fieldErrors);
  throw new Error(
    `Invalid public environment variables: ${invalidKeys.join(', ')}`,
  );
}

/**
 * Typed, validated public configuration.
 * Importing this module from anywhere (client or server) is safe.
 */
export const env = {
  apiBaseUrl: parsed.data.NEXT_PUBLIC_API_BASE_URL,
  network: parsed.data.NEXT_PUBLIC_NETWORK,
  contractId: parsed.data.NEXT_PUBLIC_CONTRACT_ID,
  explorerUrl: parsed.data.NEXT_PUBLIC_EXPLORER_URL,
  features: parsed.data.NEXT_PUBLIC_FEATURE_FLAGS,
} as const;

export type Env = typeof env;
