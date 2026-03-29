/**
 * ParserRegistry — routes Soroban contract events to the correct versioned parser.
 *
 * How it works:
 *  1. Each (contractId, schemaVersion) pair maps to an EventParser implementation.
 *  2. The indexer calls `selectParser(contractId, ledger)` to get the right parser
 *     for a given event's ledger. The deployment registry maps ledger ranges to
 *     contract schema versions, making selection deterministic.
 *  3. Unknown schemas produce a structured WarningRow — never a silent skip.
 *
 * Adding a new parser version (alongside a contract release):
 *  a. Bump SCHEMA_VERSION in events.schema.ts.
 *  b. Implement a new EventParser class (e.g. EventParserV2).
 *  c. Register it in PARSER_IMPLEMENTATIONS below.
 *  d. Add a DeploymentEntry to DEPLOYMENT_REGISTRY with the ledger at which
 *     the new contract version went live.
 *  e. Open a PR — required reviewers: backend-lead + contract-lead.
 */

import { EventKey, ParsedEvent } from './events.schema';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WarningRow {
  kind: 'unknown_schema';
  contractId: string;
  ledger: number;
  txHash: string;
  rawTopics: unknown[];
  rawPayload: unknown;
  reason: string;
}

export type ParseResult = ParsedEvent<unknown> | WarningRow;

export interface EventParser {
  /** Schema version this parser handles. */
  readonly schemaVersion: number;
  /**
   * Parse raw topics + payload into a typed ParsedEvent.
   * Returns a WarningRow if the payload does not match the expected shape.
   */
  parse(
    topics: unknown[],
    payload: unknown,
    ledger: number,
    txHash: string,
  ): ParseResult;
}

/** Maps a ledger range [fromLedger, toLedger) to a contract schema version. */
export interface DeploymentEntry {
  contractId: string;
  schemaVersion: number;
  /** Inclusive start ledger for this deployment. */
  fromLedger: number;
  /** Exclusive end ledger (undefined = still active). */
  toLedger?: number;
}

// ── V1 Parser ─────────────────────────────────────────────────────────────────

import { EVENT_PARSERS, SCHEMA_VERSION } from './events.schema';

export class EventParserV1 implements EventParser {
  readonly schemaVersion = 1;

  parse(
    topics: unknown[],
    payload: unknown,
    ledger: number,
    txHash: string,
  ): ParseResult {
    if (topics.length < 2) {
      return this.warn('topics_too_short', topics, payload, ledger, txHash, '');
    }

    const ns = String(topics[0]);
    const name = String(topics[1]);
    const key = `${ns}:${name}` as EventKey;
    const versionParsers = EVENT_PARSERS[key];

    if (!versionParsers) {
      return this.warn('unknown_event_key', topics, payload, ledger, txHash, key);
    }

    const raw = payload as Record<string, unknown>;
    const version =
      typeof raw?.version === 'number' ? raw.version : SCHEMA_VERSION;
    const parser = versionParsers[version];

    if (!parser) {
      return this.warn(
        `no_parser_for_version_${version}`,
        topics,
        payload,
        ledger,
        txHash,
        key,
      );
    }

    return {
      key,
      schemaVersion: version,
      ledger,
      txHash,
      ids: topics.slice(2),
      payload: parser(raw),
    };
  }

  private warn(
    reason: string,
    topics: unknown[],
    payload: unknown,
    ledger: number,
    txHash: string,
    contractId: string,
  ): WarningRow {
    return {
      kind: 'unknown_schema',
      contractId,
      ledger,
      txHash,
      rawTopics: topics,
      rawPayload: payload,
      reason,
    };
  }
}

// ── V2 Migration Stub ─────────────────────────────────────────────────────────

/**
 * EventParserV2 — stub for the next contract schema version.
 * Implement field migrations here when SCHEMA_VERSION bumps to 2.
 * Until then it delegates to V1 for all known events.
 */
export class EventParserV2 implements EventParser {
  readonly schemaVersion = 2;
  private readonly v1 = new EventParserV1();

  parse(
    topics: unknown[],
    payload: unknown,
    ledger: number,
    txHash: string,
  ): ParseResult {
    // TODO: handle V2-specific field renames / additions before delegating.
    return this.v1.parse(topics, payload, ledger, txHash);
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

const PARSER_IMPLEMENTATIONS: Record<number, EventParser> = {
  1: new EventParserV1(),
  2: new EventParserV2(),
};

/**
 * Deployment registry: maps (contractId, ledger range) → schema version.
 * Populated from CONTRACT_ID env at startup; extend for multi-contract setups.
 *
 * Entries are evaluated in order — first match wins.
 */
let DEPLOYMENT_REGISTRY: DeploymentEntry[] = [];

export function initDeploymentRegistry(entries: DeploymentEntry[]): void {
  DEPLOYMENT_REGISTRY = [...entries].sort((a, b) => b.fromLedger - a.fromLedger);
}

/**
 * Resolve the correct EventParser for a given contractId and ledger.
 * Selection is deterministic: same (contractId, ledger) always returns the same parser.
 */
export function selectParser(contractId: string, ledger: number): EventParser {
  for (const entry of DEPLOYMENT_REGISTRY) {
    if (
      entry.contractId === contractId &&
      ledger >= entry.fromLedger &&
      (entry.toLedger === undefined || ledger < entry.toLedger)
    ) {
      const parser = PARSER_IMPLEMENTATIONS[entry.schemaVersion];
      if (parser) return parser;
    }
  }
  // Default to V1 when no deployment entry matches (single-contract, no migration yet).
  return PARSER_IMPLEMENTATIONS[1];
}

export function isWarningRow(result: ParseResult): result is WarningRow {
  return (result as WarningRow).kind === 'unknown_schema';
}
