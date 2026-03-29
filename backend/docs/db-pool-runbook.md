# DB Connection Pool — Sizing & Runbook

## Current settings (configurable via env)

| Variable | Default | Rationale |
|---|---|---|
| `DB_POOL_MAX` | 10 | Sized for a 2-vCPU instance vs. `db.t3.medium` (max_connections ≈ 170). Leaves headroom for migrations, admin tools, and multiple replicas. |
| `DB_POOL_MIN` | 2 | Keeps warm connections ready; avoids cold-start latency. |
| `DB_POOL_IDLE_TIMEOUT_MS` | 30 000 | Reclaims idle connections after 30 s to avoid hitting DB limits during scale-down. |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | 5 000 | Fails fast on pool exhaustion — surfaces as 503 rather than a silent queue. |

Prisma encodes `connection_limit` and `pool_timeout` in the `DATABASE_URL` query string.

## Metrics

| Metric | Meaning |
|---|---|
| `db_pool_active` | Connections currently executing a query |
| `db_pool_idle` | Warm idle connections |
| `db_pool_waiting` | Requests queued waiting for a free connection |

## Diagnosing pool exhaustion

1. **`db_pool_waiting` > 0 sustained** → pool is exhausted. Increase `DB_POOL_MAX`
   (first verify headroom: `SHOW max_connections;` on the DB).
2. **`db_pool_active` pegged at `DB_POOL_MAX`** → long-running queries holding connections.
   Check `pg_stat_activity` for queries with high `duration`.
3. **`db_pool_idle` high** → pool is oversized for current load. Reduce `DB_POOL_MAX`
   or lower `DB_POOL_IDLE_TIMEOUT_MS`.
4. **503s with "pool timeout"** → `DB_POOL_CONNECTION_TIMEOUT_MS` too low for current load,
   or pool is genuinely exhausted (see step 1).

## Tuning for different deployment sizes

- **Dev / single replica**: `DB_POOL_MAX=5` is sufficient.
- **Staging (2 replicas)**: `DB_POOL_MAX=10` (default).
- **Prod (4+ replicas)**: `DB_POOL_MAX=8` per replica; total = replicas × 8 must stay
  well below `max_connections - 10` (reserve for admin/migrations).
