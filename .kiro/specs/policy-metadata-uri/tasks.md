# Implementation Plan: policy-metadata-uri

## Overview

Extend the NiffyInsure Soroban contract with optional `metadata_uri` and `metadata_integrity_hash`
fields on `Policy`, add validation, emit events, create the off-chain JSON schema and docs, wire
backend mirroring endpoints, and add a frontend `useMetadata` hook with IPFS resolution, caching,
and tamper detection.

## Tasks

- [ ] 1. Extend `types.rs` with metadata constants and Policy fields
  - Add `METADATA_URI_MAX_LEN: u32 = 128` and `METADATA_INTEGRITY_HASH_LEN: u32 = 64` constants
    alongside the existing field-size constants
  - Add `pub metadata_uri: Option<String>` and `pub metadata_integrity_hash: Option<String>` to
    the `Policy` struct with doc-comments matching the design
  - Update `dummy_policy` helper in `tests/types_validate.rs` to supply `None` for both new fields
    so existing tests continue to compile
  - _Requirements: 1.1, 1.2, 1.5, 3.3_

  - [ ]* 1.1 Write unit tests for new Policy fields
    - Assert `METADATA_URI_MAX_LEN == 128` and `METADATA_INTEGRITY_HASH_LEN == 64`
    - Assert a `Policy` constructed with `metadata_uri: None` has `metadata_uri == None`
    - _Requirements: 1.1, 1.2, 8.4_

- [ ] 2. Add metadata validation functions to `validate.rs`
  - Add `MetadataUriTooLong`, `MetadataUriEmpty`, `MetadataIntegrityHashInvalid` variants to the
    `Error` enum
  - Implement `pub fn check_metadata_uri(uri: &String) -> Result<(), Error>`: reject empty strings
    (`MetadataUriEmpty`) and strings whose byte length exceeds `METADATA_URI_MAX_LEN`
    (`MetadataUriTooLong`)
  - Implement `pub fn check_integrity_hash(hash: &String) -> Result<(), Error>`: reject strings
    whose length is not exactly 64 (`MetadataIntegrityHashInvalid`) and strings containing
    characters outside `[0-9a-f]`
  - _Requirements: 1.3, 1.4, 3.4_

  - [ ]* 2.1 Write unit tests for `check_metadata_uri` in `tests/types_validate.rs`
    - Exactly 128-byte URI passes (boundary)
    - 129-byte URI returns `MetadataUriTooLong` (boundary)
    - Empty string returns `MetadataUriEmpty`
    - _Requirements: 1.3, 1.4, 8.1, 8.2, 8.3_

  - [ ]* 2.2 Write unit tests for `check_integrity_hash` in `tests/types_validate.rs`
    - Valid 64-char lowercase hex string passes
    - 63-char string returns `MetadataIntegrityHashInvalid`
    - 65-char string returns `MetadataIntegrityHashInvalid`
    - String with uppercase hex chars returns `MetadataIntegrityHashInvalid`
    - _Requirements: 3.4, 8.6_

  - [ ]* 2.3 Write property test for oversized URI rejection (Property 1)
    - Use `proptest` to generate strings longer than 128 bytes and assert `check_metadata_uri`
      returns `Err(MetadataUriTooLong)` for all of them
    - **Property 1: Oversized URI rejected**
    - **Validates: Requirements 1.3, 8.2**

  - [ ]* 2.4 Write property tests for integrity hash validator (Property 6)
    - Use `proptest` to generate strings that are not exactly 64 lowercase hex chars and assert
      `check_integrity_hash` returns `Err(MetadataIntegrityHashInvalid)`
    - Use `proptest` to generate valid 64-char lowercase hex strings and assert `Ok(())`
    - **Property 6: Integrity hash validator rejects invalid strings**
    - **Validates: Requirements 3.4, 8.6**

- [ ] 3. Checkpoint — ensure all contract unit and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement `initiate_policy` and `renew_policy` in `policy.rs`
  - Implement `initiate_policy(env, holder, policy_id, policy_type, region, coverage, age,
    risk_score, metadata_uri, metadata_integrity_hash)`: call `check_metadata_uri` and
    `check_integrity_hash` (when `Some`) before writing to storage; revert on any error
  - Implement `renew_policy(env, holder, policy_id, metadata_uri, metadata_integrity_hash)`:
    call validators before updating storage; emit `MetadataUriUpdated` event when `metadata_uri`
    changes to a new non-`None` value using topics
    `["MetadataUriUpdated", policy_id: u32, holder: Address]` and data `new_metadata_uri: String`
  - Implement `terminate_policy(env, holder, policy_id, reason)`: deactivate policy, leave
    `metadata_uri` and `metadata_integrity_hash` unchanged
  - Expose all three functions via `NiffyInsure` contractimpl in `lib.rs`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.1 Write integration tests for `initiate_policy` metadata paths
    - `initiate_policy` with `metadata_uri = None` succeeds and stored policy has `metadata_uri == None`
    - `initiate_policy` with exactly 128-byte URI succeeds
    - `initiate_policy` with 129-byte URI returns `MetadataUriTooLong`
    - `initiate_policy` with empty URI returns `MetadataUriEmpty`
    - `initiate_policy` with invalid integrity hash returns `MetadataIntegrityHashInvalid`
    - _Requirements: 2.1, 2.3, 8.1, 8.2, 8.3, 8.4, 8.6_

  - [ ]* 4.2 Write integration tests for `renew_policy` and `terminate_policy` metadata paths
    - `renew_policy` with changed `metadata_uri` emits `MetadataUriUpdated` with correct fields
    - `terminate_policy` leaves `metadata_uri` and `metadata_integrity_hash` unchanged
    - _Requirements: 2.4, 2.5, 8.5_

  - [ ]* 4.3 Write property test for None metadata_uri round-trip (Property 2)
    - Use `proptest` to generate policies with `metadata_uri = None`, write and read back, assert
      `metadata_uri == None`
    - **Property 2: None metadata_uri round-trip**
    - **Validates: Requirements 1.5, 8.4**

  - [ ]* 4.4 Write property test for invalid URI leaves storage unchanged (Property 3)
    - Use `proptest` to generate invalid URIs (empty or oversized), call `initiate_policy` or
      `renew_policy`, assert the call reverts and storage is unchanged
    - **Property 3: Invalid URI leaves storage unchanged**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 4.5 Write property test for MetadataUriUpdated event on renew (Property 4)
    - Use `proptest` to generate valid non-`None` `metadata_uri` values, call `renew_policy`,
      assert exactly one `MetadataUriUpdated` event is emitted with correct payload
    - **Property 4: MetadataUriUpdated event emitted on renew**
    - **Validates: Requirements 2.4, 8.5**

  - [ ]* 4.6 Write property test for terminate_policy preserves metadata_uri (Property 5)
    - Use `proptest` to generate policies with arbitrary `metadata_uri` values, call
      `terminate_policy`, assert `metadata_uri` and `metadata_integrity_hash` are unchanged
    - **Property 5: terminate_policy preserves metadata_uri**
    - **Validates: Requirements 2.5**

- [ ] 5. Checkpoint — ensure all contract integration and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Create off-chain schema and documentation files
  - Create `docs/metadata-schema.json` as a valid JSON Schema draft-07 with required fields
    `schema_version` (semver string), `pii_free` (const `true`), `product_name` (non-empty
    string) and optional fields `coverage_table_url`, `marketing_copy` (max 2000 chars),
    `pdf_links` (max 10 items), `custom`
  - Create `docs/metadata-schema-changelog.md` with initial `1.0.0` entry
  - Create `docs/examples/metadata/example-auto-policy.json` as a valid example document that
    passes the schema
  - Create `docs/ipfs-pipeline.md` runbook covering: pin steps, `ipfs://` CIDv1 format
    requirement, HTTPS fallback mutability risk acknowledgement, and end-to-end example flow
  - _Requirements: 4.2, 5.1, 5.2, 5.3, 5.6, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 6.1 Write schema validation tests
    - Load `docs/metadata-schema.json` and assert it is valid JSON Schema draft-07
    - Load each file under `docs/examples/metadata/` and assert it passes the schema
    - Assert a document with `pii_free: false` fails the schema
    - Assert a document missing `product_name` fails the schema
    - _Requirements: 4.2, 5.1, 5.2, 5.6_

- [ ] 7. Add backend metadata endpoints to `backend/src/index.ts`
  - Add `ajv` dependency and load `docs/metadata-schema.json` at startup
  - Implement in-memory `MirrorEntry` store (`Map<string, MirrorEntry>`)
  - Implement `POST /policies/:policyId/metadata`: fetch URI, validate schema, check `pii_free`,
    verify SHA-256 against `metadata_integrity_hash` when present, persist entry, log operation;
    return 422 on schema/PII failure, 409 on hash mismatch, 502 on upstream fetch failure
  - Implement `GET /policies/:policyId/metadata`: return mirrored document with
    `Cache-Control: max-age=3600`
  - _Requirements: 4.2, 4.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 7.1 Write unit tests for backend metadata endpoints
    - `POST` with valid document returns 200 and persists
    - `POST` with `pii_free: false` returns 422
    - `POST` with missing required field returns 422
    - `POST` with hash mismatch returns 409
    - `GET` returns mirrored document with `Cache-Control: max-age=3600`
    - _Requirements: 4.2, 4.3, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 7.2 Write property test for backend schema/PII rejection (Property 8)
    - Use `fast-check` to generate documents that fail schema or have `pii_free !== true`, assert
      `POST` returns 422 and document is not persisted (min 100 runs)
    - **Property 8: Backend rejects documents failing schema or PII check**
    - **Validates: Requirements 4.2, 4.3, 7.2**

  - [ ]* 7.3 Write property test for backend hash mismatch rejection (Property 9)
    - Use `fast-check` to generate valid documents paired with mismatched hashes, assert `POST`
      returns 409 and document is not persisted (min 100 runs)
    - **Property 9: Backend rejects hash mismatch**
    - **Validates: Requirements 7.4**

- [ ] 8. Checkpoint — ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Add `useMetadata` hook and wire into frontend
  - Create `frontend/src/app/hooks/useMetadata.ts` implementing:
    - `resolveMetadataUri(uri, gateway)` utility: replace `ipfs://` prefix with gateway URL
    - Fetch with 5-second `AbortController` timeout
    - Client-side cache (`Map`) with 3600-second TTL
    - SHA-256 tamper detection via `crypto.subtle.digest` when `metadata_integrity_hash` is present
    - Retry logic: at most 2 retries with exponential back-off on non-2xx
    - `schema_version` recognition check
    - Returns `{ data, error, tamperWarning }`
  - Update `frontend/src/app/page.tsx` to call `useMetadata` and render metadata panel or
    appropriate notice (timeout / error / tamper-warning / unsupported-schema)
  - _Requirements: 3.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 9.1 Write unit tests for `useMetadata` hook
    - `metadata_uri = null` returns `{ data: null, error: null }`
    - `ipfs://bafyrei…` resolves to gateway URL before fetching
    - Slow mock fetch (> 5 s) returns timeout error
    - Non-2xx response retries at most 2 times
    - Mismatched hash returns `tamperWarning = true`
    - Unrecognised `schema_version` returns unsupported-schema error
    - _Requirements: 3.5, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 9.2 Write property test for frontend tamper detection (Property 7)
    - Use `fast-check` to generate document bytes and mismatched hash strings, assert
      `useMetadata` returns `tamperWarning = true` and does not expose document content (min 100 runs)
    - **Property 7: Frontend tamper detection**
    - **Validates: Requirements 3.5**

  - [ ]* 9.3 Write property test for IPFS URI gateway resolution (Property 10)
    - Use `fast-check` to generate arbitrary CID strings, prepend `ipfs://`, call
      `resolveMetadataUri`, assert result starts with the configured gateway prefix (min 100 runs)
    - **Property 10: IPFS URI gateway resolution**
    - **Validates: Requirements 6.3**

- [ ] 10. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `proptest` (Rust) and `fast-check` (TypeScript/frontend)
- Checkpoints ensure incremental validation across all three layers
