# Requirements Document

## Introduction

The Claim Aggregation Service centralizes governance math for the claims board. It pre-computes quorum progress percentages, votes-needed counts, and human-readable deadline estimates from indexed vote rows, eligible voter totals, and the contract's `quorum_bps` configuration. Results are cached in Redis and exposed on the existing `GET /claims/:id` response DTO, so the frontend can render a quorum progress bar and deadline display without implementing any governance formula itself.

## Glossary

- **ClaimAggregationService**: The NestJS service responsible for computing and caching aggregated governance fields for a claim.
- **quorum_bps**: Basis-points quorum threshold read from the on-chain deployment registry (e.g. 5100 = 51%). Determines the minimum fraction of eligible voters required for quorum.
- **quorum_progress_pct**: Integer percentage (0–100) representing how far the current approve-vote count has advanced toward the quorum threshold.
- **votes_needed**: The number of additional approve votes required to reach quorum, given the current tally and eligible voter count.
- **deadline_estimate_utc**: An approximate UTC ISO-8601 timestamp for when the voting window closes, derived from `createdAtLedger + VOTE_WINDOW_LEDGERS` and the average seconds-per-ledger constant. Approximate because Stellar ledger close times vary.
- **eligible_voter_count**: The total number of wallets eligible to vote on a claim, sourced from the on-chain policy membership snapshot stored in the database.
- **VOTE_WINDOW_LEDGERS**: The fixed ledger count defining the voting window (currently 120,960 ledgers).
- **SECONDS_PER_LEDGER**: The average ledger close time constant used for deadline estimation (currently 5 seconds).
- **AggregatedClaimDto**: The response DTO shape returned by `GET /claims/:id`, extended with the three new aggregated fields.
- **Deployment_Registry**: The on-chain contract registry from which `quorum_bps` is read at service startup and cached.
- **Redis_Cache**: The existing Redis instance used to cache aggregated results with a short TTL.

---

## Requirements

### Requirement 1: Quorum Progress Computation

**User Story:** As a frontend developer, I want the API to return a pre-computed quorum progress percentage, so that I can render a quorum progress bar without implementing governance math in the client.

#### Acceptance Criteria

1. THE ClaimAggregationService SHALL compute `quorum_progress_pct` as `floor((approve_vote_count / quorum_threshold_votes) * 100)`, clamped to the range [0, 100].
2. THE ClaimAggregationService SHALL derive `quorum_threshold_votes` as `ceil((quorum_bps / 10000) * eligible_voter_count)`.
3. THE ClaimAggregationService SHALL read `quorum_bps` from the Deployment_Registry and document the source in code comments.
4. THE ClaimAggregationService SHALL document the source of `eligible_voter_count` (policy membership snapshot) in code comments.
5. WHEN `eligible_voter_count` is zero, THE ClaimAggregationService SHALL return `quorum_progress_pct` of 0 and `votes_needed` of 0 without dividing by zero.

### Requirement 2: Votes-Needed Computation

**User Story:** As a frontend developer, I want the API to return the number of additional approve votes needed, so that I can display actionable voting progress to users.

#### Acceptance Criteria

1. THE ClaimAggregationService SHALL compute `votes_needed` as `max(0, quorum_threshold_votes - approve_vote_count)`.
2. WHEN quorum has already been reached, THE ClaimAggregationService SHALL return `votes_needed` of 0.
3. THE ClaimAggregationService SHALL use the same `quorum_threshold_votes` value as used in `quorum_progress_pct` computation to ensure consistency between the two fields.

### Requirement 3: Deadline Estimate Computation

**User Story:** As a frontend developer, I want the API to return a human-readable UTC deadline estimate, so that I can display the voting window close time without computing ledger arithmetic on the client.

#### Acceptance Criteria

1. THE ClaimAggregationService SHALL compute `deadline_estimate_utc` as the ISO-8601 UTC timestamp of `claim.createdAt + (VOTE_WINDOW_LEDGERS * SECONDS_PER_LEDGER * 1000 ms)`.
2. THE ClaimAggregationService SHALL include a code comment and API documentation note stating that `deadline_estimate_utc` is approximate due to variable Stellar ledger close times.
3. WHEN a claim's voting window has already closed, THE ClaimAggregationService SHALL still return the historical `deadline_estimate_utc` value.

### Requirement 4: Contract Formula Alignment

**User Story:** As a protocol engineer, I want the backend quorum formula to match the on-chain contract formula, so that the UI and contract always agree on quorum status.

#### Acceptance Criteria

1. THE ClaimAggregationService SHALL use `quorum_bps` sourced from the Deployment_Registry rather than a hardcoded constant.
2. THE ClaimAggregationService SHALL include a code comment referencing the contract function or registry key from which `quorum_bps` is read.
3. WHEN `quorum_bps` changes in the Deployment_Registry, THE ClaimAggregationService SHALL reflect the updated value within one cache TTL cycle without requiring a service restart.

### Requirement 5: Redis Caching with Invalidation

**User Story:** As a backend engineer, I want aggregated results cached in Redis with a short TTL, so that repeated reads are fast and cache entries are invalidated when new votes arrive.

#### Acceptance Criteria

1. THE ClaimAggregationService SHALL store aggregated results in Redis_Cache under the key pattern `claims:aggregated:{claimId}` with a TTL of 30 seconds or less.
2. WHEN a new Vote row is written to the database for a given claim, THE ClaimAggregationService SHALL delete the Redis_Cache entry for that claim's aggregated key.
3. IF Redis_Cache is unavailable, THEN THE ClaimAggregationService SHALL compute and return aggregated results directly from the database without throwing an error.
4. THE ClaimAggregationService SHALL not cache results that contain stale `quorum_bps` values older than the configured TTL.

### Requirement 6: DTO Extension for GET /claims/:id

**User Story:** As a frontend developer, I want the `GET /claims/:id` response to include the three aggregated fields, so that a single API call provides everything needed to render the claim detail view.

#### Acceptance Criteria

1. THE ClaimsController SHALL include `quorum_progress_pct`, `votes_needed`, and `deadline_estimate_utc` in the `GET /claims/:id` response DTO.
2. THE AggregatedClaimDto SHALL expose `quorum_progress_pct` as an integer in [0, 100].
3. THE AggregatedClaimDto SHALL expose `votes_needed` as a non-negative integer.
4. THE AggregatedClaimDto SHALL expose `deadline_estimate_utc` as an ISO-8601 UTC string.
5. THE ClaimsController SHALL document `deadline_estimate_utc` in the OpenAPI schema with a note that the value is approximate.

### Requirement 7: Unit Tests with Fixed Fixtures

**User Story:** As a backend engineer, I want unit tests with fixed vote/voter fixtures that verify formula correctness, so that any formula change requires an intentional test vector update.

#### Acceptance Criteria

1. THE ClaimAggregationService test suite SHALL include at least one test fixture with known `approve_vote_count`, `eligible_voter_count`, and `quorum_bps` values and assert the exact expected `quorum_progress_pct` and `votes_needed` outputs.
2. THE ClaimAggregationService test suite SHALL include a fixture where quorum is exactly met (boundary condition) and assert `quorum_progress_pct` of 100 and `votes_needed` of 0.
3. THE ClaimAggregationService test suite SHALL include a fixture where `eligible_voter_count` is zero and assert no division-by-zero error occurs.
4. THE ClaimAggregationService test suite SHALL include a fixture verifying `deadline_estimate_utc` matches the expected UTC timestamp for a known `createdAt` and `createdAtLedger` input.
5. WHEN the quorum formula is changed, THE ClaimAggregationService test suite SHALL fail on existing fixtures, requiring explicit test vector updates to pass.
