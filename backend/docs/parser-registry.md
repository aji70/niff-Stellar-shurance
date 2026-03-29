# Event Parser Registry

Versioned Soroban event parsing lives in `src/events/parser-registry.ts`.

## How parser selection works

1. At startup, `IndexerService` calls `initDeploymentRegistry([...])` with entries mapping
   `(contractId, fromLedger)` → `schemaVersion`.
2. For each incoming event, `selectParser(contractId, ledger)` finds the entry whose
   `fromLedger ≤ event.ledger < toLedger` and returns the matching `EventParser`.
3. Selection is **deterministic**: the same `(contractId, ledger)` always returns the same parser,
   making historical reindexes safe.
4. Unknown event schemas produce a structured `WarningRow` (logged as `unknown_event_schema`)
   — never a silent skip.

## Adding a parser for a new contract version

1. Bump `SCHEMA_VERSION` in `events.schema.ts`.
2. Implement a new class (e.g. `EventParserV2`) in `parser-registry.ts` handling the new shape.
3. Register it in `PARSER_IMPLEMENTATIONS`.
4. Add a `DeploymentEntry` to the `initDeploymentRegistry(...)` call in `IndexerService`
   with the ledger at which the upgraded contract went live:
   ```ts
   { contractId, schemaVersion: 2, fromLedger: <upgrade_ledger> },
   ```
5. Set `toLedger` on the previous entry to the same ledger.
6. Open a PR — required reviewers: **backend-lead** + **contract-lead**.

## Mixed-version reindexes

Because each event carries its own ledger, the registry automatically routes old events to V1
and new events to V2 during a rolling upgrade or historical reindex. No full reindex needed.
