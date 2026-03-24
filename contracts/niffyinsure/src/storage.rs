//! # Storage module — single source of truth for all Soroban persistence.
//!
//! ## Keyspace diagram
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │  INSTANCE storage  (lives as long as the contract instance)             │
//! │  Bumped on every mutating call via bump_instance().                     │
//! │                                                                         │
//! │  DataKey::Admin          → Address   (contract administrator)           │
//! │  DataKey::Token          → Address   (SEP-41 token contract)            │
//! │  DataKey::Paused         → bool      (circuit-breaker flag)             │
//! │  DataKey::ClaimCounter   → u64       (global monotonic claim id)        │
//! │  DataKey::Voters         → Vec<Address> (active policyholder set)       │
//! └─────────────────────────────────────────────────────────────────────────┘
//!
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │  PERSISTENT storage  (survives eviction; must be bumped periodically)   │
//! │                                                                         │
//! │  DataKey::PolicyCounter(holder: Address)                                │
//! │      → u32   next policy_id for this holder (starts at 1)              │
//! │                                                                         │
//! │  DataKey::Policy(holder: Address, policy_id: u32)                       │
//! │      → Policy   full policy record                                      │
//! │                                                                         │
//! │  DataKey::Claim(claim_id: u64)                                          │
//! │      → Claim   full claim record                                        │
//! │                                                                         │
//! │  DataKey::Vote(claim_id: u64, voter: Address)                           │
//! │      → VoteOption   ballot cast by voter on claim                       │
//! └─────────────────────────────────────────────────────────────────────────┘
//!
//! ## Storage tier rationale
//!
//! | Key                  | Tier       | Justification                              |
//! |----------------------|------------|--------------------------------------------|
//! | Admin / Token        | Instance   | Accessed on every call; eviction = DoS     |
//! | Paused               | Instance   | Circuit-breaker must always be readable    |
//! | ClaimCounter         | Instance   | Monotonic; must never be lost              |
//! | Voters               | Instance   | Iterated on every vote tally               |
//! | PolicyCounter        | Persistent | Per-holder; infrequently accessed          |
//! | Policy               | Persistent | Long-lived; bumped on write                |
//! | Claim                | Persistent | Long-lived; bumped on write                |
//! | Vote                 | Persistent | Long-lived; bumped on write                |
//!
//! Temporary storage is intentionally NOT used: all data here is long-lived
//! and must survive beyond a single transaction or ledger close window.
//!
//! ## Rules for callers
//!
//! - Domain modules (policy.rs, claim.rs, token.rs) MUST NOT construct
//!   DataKey values or call env.storage() directly.
//! - All reads/writes go through the typed helpers in this module.

use crate::types::{Claim, Policy, VoteOption};
use soroban_sdk::{contracttype, Address, Env, Vec};

// ── TTL constants ─────────────────────────────────────────────────────────────
//
// Soroban persistent entries are evicted when their TTL reaches 0.
// We extend on every write so active data is never silently lost.
//
// ~1 year at ~5 s/ledger ≈ 6_307_200 ledgers.  We use a round number.
/// Minimum TTL threshold before we extend (in ledgers).
pub const PERSISTENT_TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (in ledgers, ~1 year).
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_000_000;

// ── DataKey ───────────────────────────────────────────────────────────────────

/// Exhaustive enumeration of every storage key used by the contract.
///
/// Variants are grouped by storage tier in the keyspace diagram above.
/// No other module may construct these variants directly.
#[contracttype]
pub enum DataKey {
    // ── Instance tier ────────────────────────────────────────────────────
    /// Contract administrator address.
    Admin,
    /// SEP-41 token contract used for premium payments and claim payouts.
    Token,
    /// Circuit-breaker: when true, all mutating entrypoints are blocked.
    Paused,
    /// Global monotonic claim id counter; incremented by `next_claim_id`.
    ClaimCounter,
    /// Ordered list of all active policyholder addresses eligible to vote.
    Voters,

    // ── Persistent tier ──────────────────────────────────────────────────
    /// Per-holder policy id counter; value = last assigned policy_id.
    PolicyCounter(Address),
    /// Full policy record keyed by (holder, per-holder policy_id).
    Policy(Address, u32),
    /// Full claim record keyed by global claim_id.
    Claim(u64),
    /// Ballot cast by `voter` on `claim_id`; absence = not yet voted.
    Vote(u64, Address),
}

// ── Instance bump ─────────────────────────────────────────────────────────────

/// Extend instance storage TTL so admin/token/counters are never evicted.
/// Call at the start of every mutating entrypoint.
pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Panics if admin was never set (contract not initialised).
pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("contract not initialised: admin missing")
}

// ── Token ─────────────────────────────────────────────────────────────────────

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

/// Panics if token was never set (contract not initialised).
pub fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("contract not initialised: token missing")
}

// ── Pause flag ────────────────────────────────────────────────────────────────

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

/// Returns false if the key has never been written (default = not paused).
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

// ── Claim counter (instance) ──────────────────────────────────────────────────

/// Returns the current claim counter value (0 if no claims filed yet).
pub fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
}

/// Increments the global claim counter and returns the new (next) claim_id.
pub fn next_claim_id(env: &Env) -> u64 {
    let next: u64 = get_claim_counter(env) + 1;
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}

// ── Voters (instance) ─────────────────────────────────────────────────────────

/// Returns the current voter list; empty Vec if none registered yet.
pub fn get_voters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Voters)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_voters(env: &Env, voters: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Voters, voters);
}

/// Adds `holder` to the voter list if not already present.
pub fn add_voter(env: &Env, holder: &Address) {
    let mut voters = get_voters(env);
    for v in voters.iter() {
        if v == *holder {
            return;
        }
    }
    voters.push_back(holder.clone());
    set_voters(env, &voters);
}

/// Removes `holder` from the voter list (no-op if absent).
pub fn remove_voter(env: &Env, holder: &Address) {
    let voters = get_voters(env);
    let mut updated: Vec<Address> = Vec::new(env);
    for v in voters.iter() {
        if v != *holder {
            updated.push_back(v);
        }
    }
    set_voters(env, &updated);
}

// ── Policy counter (persistent) ───────────────────────────────────────────────

/// Returns the last assigned policy_id for `holder` (0 = none yet).
pub fn get_policy_counter(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyCounter(holder.clone()))
        .unwrap_or(0u32)
}

/// Increments the per-holder policy counter and returns the new policy_id.
pub fn next_policy_id(env: &Env, holder: &Address) -> u32 {
    let key = DataKey::PolicyCounter(holder.clone());
    let next: u32 = env.storage().persistent().get(&key).unwrap_or(0u32) + 1;
    env.storage().persistent().set(&key, &next);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    next
}

// ── Policy (persistent) ───────────────────────────────────────────────────────

pub fn has_policy(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Policy(holder.clone(), policy_id))
}

/// Returns `None` if the policy does not exist.
pub fn get_policy(env: &Env, holder: &Address, policy_id: u32) -> Option<Policy> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(holder.clone(), policy_id))
}

/// Panics with a clear message if the policy does not exist.
pub fn get_policy_or_panic(env: &Env, holder: &Address, policy_id: u32) -> Policy {
    get_policy(env, holder, policy_id)
        .expect("policy not found: (holder, policy_id) does not exist")
}

pub fn set_policy(env: &Env, policy: &Policy) {
    let key = DataKey::Policy(policy.holder.clone(), policy.policy_id);
    env.storage().persistent().set(&key, policy);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// ── Claim (persistent) ────────────────────────────────────────────────────────

/// Returns `None` if the claim does not exist.
pub fn get_claim(env: &Env, claim_id: u64) -> Option<Claim> {
    env.storage().persistent().get(&DataKey::Claim(claim_id))
}

/// Panics with a clear message if the claim does not exist.
pub fn get_claim_or_panic(env: &Env, claim_id: u64) -> Claim {
    get_claim(env, claim_id).expect("claim not found: claim_id does not exist")
}

pub fn set_claim(env: &Env, claim: &Claim) {
    let key = DataKey::Claim(claim.claim_id);
    env.storage().persistent().set(&key, claim);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

// ── Vote (persistent) ─────────────────────────────────────────────────────────

/// Returns `None` if `voter` has not yet voted on `claim_id`.
pub fn get_vote(env: &Env, claim_id: u64, voter: &Address) -> Option<VoteOption> {
    env.storage()
        .persistent()
        .get(&DataKey::Vote(claim_id, voter.clone()))
}

pub fn set_vote(env: &Env, claim_id: u64, voter: &Address, vote: &VoteOption) {
    let key = DataKey::Vote(claim_id, voter.clone());
    env.storage().persistent().set(&key, vote);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}
