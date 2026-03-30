import * as Joi from "joi";

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string()
    .required()
    .description("PostgreSQL connection URL"),
  REDIS_URL: Joi.string().required().description("Redis connection URL"),
  STELLAR_NETWORK: Joi.string()
    .valid('testnet', 'mainnet', 'futurenet')
    .default('testnet')
    .description('Active Stellar network: testnet | mainnet | futurenet'),
  SOROBAN_RPC_URL: Joi.string().uri().required().description('Soroban RPC endpoint for the active network'),
  HORIZON_URL: Joi.string().uri().required().description('Horizon endpoint for the active network'),
  STELLAR_NETWORK_PASSPHRASE: Joi.string()
    .required()
    .description('Must match the canonical passphrase for STELLAR_NETWORK or startup fails'),
  CONTRACT_ID: Joi.string().allow('').default('').description('niffyinsure contract ID on the active network'),
  DEFAULT_TOKEN_CONTRACT_ID: Joi.string().allow('').default('').description('Default SEP-41 token contract ID'),
  // Per-network overrides (used in multi-network CI)
  SOROBAN_RPC_URL_TESTNET: Joi.string().uri().allow('').description('Testnet RPC override'),
  SOROBAN_RPC_URL_MAINNET: Joi.string().uri().allow('').description('Mainnet RPC override'),
  SOROBAN_RPC_URL_FUTURENET: Joi.string().uri().allow('').description('Futurenet RPC override'),
  HORIZON_URL_TESTNET: Joi.string().uri().allow('').description('Testnet Horizon override'),
  HORIZON_URL_MAINNET: Joi.string().uri().allow('').description('Mainnet Horizon override'),
  HORIZON_URL_FUTURENET: Joi.string().uri().allow('').description('Futurenet Horizon override'),
  CONTRACT_ID_TESTNET: Joi.string().allow('').description('Testnet contract ID override'),
  CONTRACT_ID_MAINNET: Joi.string().allow('').description('Mainnet contract ID override'),
  CONTRACT_ID_FUTURENET: Joi.string().allow('').description('Futurenet contract ID override'),
  INDEXER_GAP_ALERT_THRESHOLD_LEDGERS: Joi.number()
    .integer()
    .min(1)
    .default(100)
    .description("Alert when chain head minus last_processed exceeds this"),
  INDEXER_GAP_ALERT_COOLDOWN_MS: Joi.number()
    .integer()
    .min(60_000)
    .default(3_600_000)
    .description("Minimum milliseconds between gap alerts per network"),
  // IPFS Configuration
  IPFS_PROVIDER: Joi.string()
    .valid("mock", "pinata")
    .default("mock")
    .description("IPFS provider to use"),
  PINATA_API_KEY: Joi.string().allow("").description("Pinata API key"),
  PINATA_API_SECRET: Joi.string().allow("").description("Pinata API secret"),
  PINATA_GATEWAY_URL: Joi.string()
    .default("https://gateway.pinata.cloud/ipfs")
    .description("Pinata gateway URL"),
  IPFS_MAX_FILE_SIZE: Joi.number()
    .default(52428800)
    .description("Maximum file size in bytes (default: 50MB)"),
  IPFS_MIN_FILE_SIZE: Joi.number()
    .default(1)
    .description("Minimum file size in bytes"),
  IPFS_STRIP_EXIF: Joi.boolean()
    .default(true)
    .description("Strip EXIF metadata from images"),
  // Legacy IPFS config (kept for compatibility)
  IPFS_GATEWAY: Joi.string().default("https://ipfs.io"),
  IPFS_PROJECT_ID: Joi.string().allow(""),
  IPFS_PROJECT_SECRET: Joi.string().allow(""),
  // Auth
  JWT_SECRET: Joi.string().min(32).required(),
  ADMIN_TOKEN: Joi.string().required(),
  // CORS
  // CORS_ORIGINS is deprecated — use FRONTEND_ORIGINS instead
  FRONTEND_ORIGINS: Joi.string()
    .required()
    .description("Comma-separated public frontend CORS origins")
    .custom((value: string, helpers) => {
      const nodeEnv =
        (helpers.state.ancestors[0] as Record<string, string>)?.NODE_ENV ??
        "development";
      if (nodeEnv !== "production") {
        // development / test: any non-empty string is accepted
        return value;
      }
      // production: every entry must start with https:// and none may equal '*'
      const entries = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const entry of entries) {
        if (entry === "*") {
          return helpers.error("any.invalid", {
            message: 'FRONTEND_ORIGINS must not contain "*" in production',
          });
        }
        if (!entry.startsWith("https://")) {
          return helpers.error("any.invalid", {
            message: `FRONTEND_ORIGINS entry "${entry}" must start with https:// in production`,
          });
        }
      }
      return value;
    }),
  ADMIN_CORS_ORIGINS: Joi.string()
    .allow("")
    .default("")
    .description("Comma-separated admin UI CORS origins"),
  // Logging
  LOG_LEVEL: Joi.string()
    .default("info")
    .valid("error", "warn", "log", "verbose", "debug"),
  // Cache
  CACHE_TTL_SECONDS: Joi.number()
    .default(60)
    .description("Cache TTL in seconds"),
  QUOTE_SIMULATION_CACHE_ENABLED: Joi.string()
    .valid("true", "false", "1", "0")
    .default("true")
    .description("Redis cache for successful Soroban quote simulations"),
  QUOTE_SIMULATION_CACHE_TTL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(600)
    .default(30)
    .description("TTL for quote simulation cache entries (seconds)"),
  // CAPTCHA (Turnstile or hCaptcha)
  CAPTCHA_PROVIDER: Joi.string()
    .valid("turnstile", "hcaptcha")
    .default("turnstile"),
  CAPTCHA_SECRET_KEY: Joi.string()
    .allow("")
    .default("dev-skip")
    .description("Server-side CAPTCHA secret"),
  CAPTCHA_SITE_KEY: Joi.string()
    .allow("")
    .description("Client-side CAPTCHA site key (exposed to frontend)"),
  // Support
  IP_HASH_SALT: Joi.string()
    .allow("")
    .default("niff-salt")
    .description("Salt for IP hashing"),
  // Multi-tenancy
  TENANT_RESOLUTION_ENABLED: Joi.boolean()
    .default(false)
    .description("Enable tenant resolution from subdomain / x-tenant-id header"),
  TENANT_BASE_DOMAIN: Joi.string()
    .default("niffyinsur.com")
    .description("Base domain for subdomain-based tenant resolution"),
  // Soft-delete retention: materialized rows with deleted_at older than this are purged daily
  DATA_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .default(730)
    .description(
      "Days to retain soft-deleted policies/claims/votes before hard-delete (raw_events untouched)",
    ),
  // DB connection pool (Prisma)
  DB_POOL_MAX: Joi.number().integer().min(1).default(10)
    .description('Max DB connections in the pool'),
  DB_POOL_MIN: Joi.number().integer().min(0).default(2)
    .description('Min warm DB connections'),
  DB_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().min(1000).default(30_000)
    .description('Idle connection reclaim timeout (ms)'),
  DB_POOL_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(500).default(5_000)
    .description('Max wait for a free connection before failing (ms)'),
  DB_SLOW_QUERY_MS: Joi.number().integer().min(10).default(250)
    .description('Warn when a single DB query exceeds this latency threshold (ms)'),
  GRAPHQL_ENABLED: Joi.boolean().default(true)
    .description('Enable the GraphQL endpoint'),
  GRAPHQL_PATH: Joi.string().default('/graphql')
    .description('HTTP path for GraphQL requests'),
  GRAPHQL_INTROSPECTION_IN_PRODUCTION: Joi.boolean().default(false)
    .description('Allow schema introspection when NODE_ENV=production'),
  GRAPHQL_MAX_DEPTH: Joi.number().integer().min(1).default(8)
    .description('Maximum allowed GraphQL selection depth'),
  GRAPHQL_MAX_COMPLEXITY: Joi.number().integer().min(1).default(250)
    .description('Maximum estimated GraphQL query cost'),
  GRAPHQL_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(60)
    .description('Maximum GraphQL operations per rate-limit window'),
  GRAPHQL_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60_000)
    .description('GraphQL rate-limit window length in milliseconds'),
  GRAPHQL_SLOW_OPERATION_MS: Joi.number().integer().min(10).default(750)
    .description('Warn when a GraphQL operation exceeds this latency threshold (ms)'),
  GRAPHQL_PERSISTED_QUERIES_ENABLED: Joi.boolean().default(false)
    .description('Enable Apollo-style automatic persisted queries for GraphQL clients'),
  GRAPHQL_PERSISTED_QUERY_TTL_SECONDS: Joi.number().integer().min(60).default(86_400)
    .description('TTL for persisted GraphQL queries stored in Redis'),
  GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT: Joi.number().integer().min(1).max(100).default(10)
    .description('Default nested claims page size when resolving policy.claims'),
  GRAPHQL_POLICY_CLAIMS_MAX_LIMIT: Joi.number().integer().min(1).max(250).default(25)
    .description('Maximum nested claims page size when resolving policy.claims'),
});
