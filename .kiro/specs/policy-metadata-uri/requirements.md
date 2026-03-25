# Requirements Document

## Introduction

The `policy-metadata-uri` feature adds an optional `metadata_uri` field to the on-chain `Policy`
struct in the NiffyInsure Soroban contract. The field stores a compact URI or content-addressed
hash (IPFS CIDv1 or HTTPS URL) that points to a richer JSON document hosted off-chain. That
document may contain marketing copy, coverage-table PDF links, product-version metadata, or other
non-sensitive supplementary information. The field is intentionally narrow (strict byte-length
cap) to avoid chain-storage bloat and to prevent accidental PII leakage. The Next.js frontend
fetches and caches the referenced document; the TypeScript backend may mirror it for SEO or
compliance archiving. The JSON schema is versioned independently of the contract and is checked
into the repository with documented evolution rules.

---

## Glossary

- **Contract**: The NiffyInsure Soroban smart contract deployed on Stellar.
- **Policy**: The on-chain `Policy` struct defined in `types.rs`; the authoritative record of a
  single insurance policy.
- **Metadata_URI**: The optional string field added to `Policy` that holds either an IPFS CIDv1
  URI (e.g. `ipfs://bafyrei…`) or an HTTPS URL pointing to the off-chain metadata JSON document.
- **Metadata_JSON**: The off-chain JSON document referenced by `Metadata_URI`; its schema is
  defined and versioned in `docs/metadata-schema.json`.
- **CIDv1**: A content-addressed identifier produced by IPFS; immutable by construction — the
  hash changes if the content changes.
- **IPFS_Pipeline**: The off-chain tooling (CI script or backend service) responsible for pinning
  content to IPFS and returning a CIDv1 URI.
- **Validator**: The Rust validation module `validate.rs` that enforces field constraints before
  any state mutation.
- **Frontend**: The Next.js application in `frontend/`.
- **Backend**: The TypeScript Express service in `backend/src/index.ts`.
- **Schema_Version**: A semver string embedded in `Metadata_JSON` (e.g. `"1.0.0"`) that
  identifies the JSON schema revision in use.
- **Integrity_Hash**: An optional SHA-256 hex digest of the canonical `Metadata_JSON` bytes,
  stored alongside `Metadata_URI` to enable tamper-evidence verification.
- **METADATA_URI_MAX_LEN**: The compile-time constant (128 bytes) that caps `Metadata_URI`
  length; defined in `types.rs` alongside existing field-size constants.

---

## Requirements

### Requirement 1: Optional Metadata URI Field on Policy

**User Story:** As a product manager, I want to attach a URI or content hash to a policy, so that
richer off-chain documentation can be linked without bloating on-chain storage.

#### Acceptance Criteria

1. THE Contract SHALL define a constant `METADATA_URI_MAX_LEN` equal to 128 bytes in `types.rs`,
   alongside the existing field-size constants.
2. THE Policy struct SHALL include an optional `metadata_uri` field of type `Option<String>` that
   defaults to `None` when not supplied.
3. WHEN a caller provides a `metadata_uri` value, THE Validator SHALL reject any value whose byte
   length exceeds `METADATA_URI_MAX_LEN` and return a `MetadataUriTooLong` error.
4. WHEN a caller provides a `metadata_uri` value of zero bytes, THE Validator SHALL reject it and
   return a `MetadataUriEmpty` error.
5. WHERE `metadata_uri` is `None`, THE Contract SHALL store the policy without a metadata
   reference and SHALL NOT allocate ledger storage for the absent field beyond the `Option`
   discriminant.

---

### Requirement 2: Validation on Policy Create and Update

**User Story:** As a smart-contract developer, I want metadata URI validation enforced at every
mutating entrypoint, so that invalid or oversized strings never reach persistent storage.

#### Acceptance Criteria

1. WHEN `initiate_policy` is called with a non-`None` `metadata_uri`, THE Validator SHALL execute
   `check_metadata_uri` before writing the `Policy` to storage.
2. WHEN `renew_policy` is called with a non-`None` `metadata_uri`, THE Validator SHALL execute
   `check_metadata_uri` before updating the stored `Policy`.
3. IF `check_metadata_uri` returns an error, THEN THE Contract SHALL revert the transaction and
   SHALL NOT modify any storage entry.
4. WHEN `metadata_uri` is updated to a new non-`None` value during `renew_policy`, THE Contract
   SHALL emit a `MetadataUriUpdated` contract event containing the `policy_id`, `holder` address,
   and the new `metadata_uri` value.
5. WHEN `terminate_policy` is called, THE Contract SHALL preserve the existing `metadata_uri`
   value in the stored `Policy` record unchanged.

---

### Requirement 3: Immutable CID Preference and Integrity Hash

**User Story:** As a compliance officer, I want metadata references to be tamper-evident, so that
I can verify the off-chain document has not been altered after the policy was issued.

#### Acceptance Criteria

1. THE IPFS_Pipeline SHALL produce CIDv1 URIs prefixed with `ipfs://` for all metadata documents
   it pins, ensuring content-addressed immutability.
2. WHERE an HTTPS URL is used instead of a CIDv1 URI, THE Backend SHALL document the mutability
   risk in the IPFS pipeline runbook and SHALL require explicit operator acknowledgement.
3. WHERE tamper-evidence is required, THE Policy struct SHALL include an optional
   `metadata_integrity_hash` field of type `Option<String>` holding a lowercase hex-encoded
   SHA-256 digest (64 characters) of the canonical `Metadata_JSON` bytes.
4. WHEN `metadata_integrity_hash` is provided, THE Validator SHALL verify that its length equals
   exactly 64 characters and that it contains only hexadecimal characters `[0-9a-f]`; IF either
   check fails, THEN THE Contract SHALL return a `MetadataIntegrityHashInvalid` error.
5. THE Frontend SHALL, after fetching `Metadata_JSON`, compute the SHA-256 digest of the received
   bytes and SHALL compare it to `metadata_integrity_hash` when that field is present; IF the
   digests differ, THEN THE Frontend SHALL display a tamper-warning banner and SHALL NOT render
   the metadata content.

---

### Requirement 4: PII and Data-Privacy Guardrails

**User Story:** As a data-privacy officer, I want the system to prevent personal data from being
placed in publicly resolvable metadata, so that the platform remains compliant with applicable
privacy regulations.

#### Acceptance Criteria

1. THE Contract SHALL NOT store any field that directly encodes policyholder personal data (name,
   date of birth, national ID, contact details) within `metadata_uri` or
   `metadata_integrity_hash`.
2. THE Metadata_JSON schema SHALL define a `pii_free` boolean field that MUST be set to `true`;
   documents with `pii_free: false` or the field absent SHALL be rejected by the Backend metadata
   ingestion endpoint.
3. WHEN the Backend receives a metadata document for mirroring, THE Backend SHALL validate the
   document against `Metadata_JSON` schema version declared in the document's `schema_version`
   field before storing it; IF validation fails, THEN THE Backend SHALL return HTTP 422 and SHALL
   NOT persist the document.
4. THE IPFS_Pipeline documentation SHALL state that uploading documents containing PII to a public
   IPFS node without legal clearance is prohibited.

---

### Requirement 5: Off-Chain Metadata JSON Schema

**User Story:** As a frontend developer, I want a versioned, documented JSON schema for the
metadata document, so that I can reliably parse and display policy metadata across schema
versions.

#### Acceptance Criteria

1. THE Contract repository SHALL contain a file at `docs/metadata-schema.json` that is a valid
   JSON Schema (draft-07 or later) defining all required and optional fields of `Metadata_JSON`.
2. THE `Metadata_JSON` schema SHALL require the following fields: `schema_version` (semver
   string), `pii_free` (boolean `true`), and `product_name` (non-empty string).
3. THE `Metadata_JSON` schema SHALL permit the following optional fields: `coverage_table_url`
   (URI string), `marketing_copy` (string, max 2 000 characters), `pdf_links` (array of URI
   strings, max 10 items), and `custom` (free-form object for product-specific extensions).
4. WHEN a breaking change is made to `Metadata_JSON` schema, THE repository SHALL increment the
   major component of `schema_version` and SHALL add a migration note to
   `docs/metadata-schema-changelog.md`.
5. WHEN a non-breaking additive change is made to `Metadata_JSON` schema, THE repository SHALL
   increment the minor component of `schema_version` and SHALL update `docs/metadata-schema.json`
   without removing existing required fields.
6. THE repository SHALL include at least one valid example `Metadata_JSON` document under
   `docs/examples/metadata/` that passes schema validation.

---

### Requirement 6: Frontend Fetch and Cache

**User Story:** As a policyholder, I want the policy detail page to display enriched metadata
from the linked document, so that I can see coverage tables and product information without
leaving the application.

#### Acceptance Criteria

1. WHEN the policy detail page loads and `metadata_uri` is non-null, THE Frontend SHALL fetch the
   referenced document using the resolved URL within 5 seconds; IF the fetch does not complete
   within 5 seconds, THEN THE Frontend SHALL display a timeout notice and SHALL render the page
   without metadata content.
2. THE Frontend SHALL cache fetched `Metadata_JSON` responses using HTTP cache headers or a
   client-side cache with a maximum age of 3 600 seconds to avoid redundant network requests.
3. WHEN `metadata_uri` begins with `ipfs://`, THE Frontend SHALL resolve it through a configured
   IPFS gateway URL (e.g. `https://ipfs.io/ipfs/{CID}`) before issuing the HTTP request.
4. IF the fetch returns a non-2xx HTTP status, THEN THE Frontend SHALL display an error notice
   and SHALL NOT attempt automatic retry more than 2 times with exponential back-off.
5. THE Frontend SHALL validate the fetched document against the declared `schema_version` before
   rendering; IF the `schema_version` is unrecognised, THEN THE Frontend SHALL display an
   unsupported-schema notice.

---

### Requirement 7: Backend Mirroring and SEO / Compliance Archive

**User Story:** As a platform operator, I want the backend to mirror metadata documents, so that
search engines can index policy information and compliance archives remain available even if the
original IPFS pin is lost.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /policies/:policyId/metadata` endpoint that accepts a
   `metadata_uri` string and fetches the referenced document for mirroring.
2. WHEN the Backend mirrors a document, THE Backend SHALL validate it against the `Metadata_JSON`
   schema before persisting; IF validation fails, THEN THE Backend SHALL return HTTP 422.
3. THE Backend SHALL expose a `GET /policies/:policyId/metadata` endpoint that returns the
   mirrored `Metadata_JSON` document with appropriate `Cache-Control` headers.
4. WHEN `metadata_integrity_hash` is present on the policy, THE Backend SHALL verify the SHA-256
   digest of the fetched document matches `metadata_integrity_hash`; IF the digests differ, THEN
   THE Backend SHALL return HTTP 409 and SHALL NOT persist the document.
5. THE Backend SHALL log each mirroring operation with the `policy_id`, `metadata_uri`, fetch
   timestamp, and validation outcome for compliance audit purposes.

---

### Requirement 8: Contract Tests for Metadata URI Validation

**User Story:** As a smart-contract developer, I want automated tests that exercise the metadata
URI validation boundaries, so that regressions in length enforcement are caught before deployment.

#### Acceptance Criteria

1. THE test suite SHALL include a test that calls `initiate_policy` with a `metadata_uri` of
   exactly `METADATA_URI_MAX_LEN` bytes and asserts the call succeeds.
2. THE test suite SHALL include a test that calls `initiate_policy` with a `metadata_uri` of
   `METADATA_URI_MAX_LEN + 1` bytes and asserts the call returns `MetadataUriTooLong`.
3. THE test suite SHALL include a test that calls `initiate_policy` with an empty `metadata_uri`
   string and asserts the call returns `MetadataUriEmpty`.
4. THE test suite SHALL include a test that calls `initiate_policy` with `metadata_uri` set to
   `None` and asserts the call succeeds and the stored policy has `metadata_uri` equal to `None`.
5. THE test suite SHALL include a test that calls `renew_policy` with a changed `metadata_uri`
   and asserts that a `MetadataUriUpdated` event is emitted with the correct fields.
6. WHEN `metadata_integrity_hash` is provided with a non-hex or wrong-length value, THE test
   suite SHALL assert the call returns `MetadataIntegrityHashInvalid`.

---

### Requirement 9: IPFS Pipeline Integration Documentation

**User Story:** As a DevOps engineer, I want clear documentation on how metadata URIs are
produced and represented, so that the IPFS pipeline and the contract use a consistent URI format.

#### Acceptance Criteria

1. THE repository SHALL contain a runbook at `docs/ipfs-pipeline.md` describing the steps to pin
   a `Metadata_JSON` document to IPFS and obtain a CIDv1 URI.
2. THE runbook SHALL specify that all CIDv1 URIs stored in `metadata_uri` MUST use the
   `ipfs://` scheme prefix and base32 encoding (e.g. `ipfs://bafyrei…`).
3. THE runbook SHALL document the HTTPS gateway fallback pattern and the associated mutability
   risk acknowledgement process.
4. THE runbook SHALL include an example end-to-end flow: author document → validate schema →
   pin to IPFS → record CIDv1 in `initiate_policy` call → Frontend resolves via gateway.
