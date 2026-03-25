use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{Claim, Policy, VoteOption};

pub const PERSISTENT_TTL_THRESHOLD: u32 = 100_000;
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_000_000;

// ── DataKey ───────────────────────────────────────────────────────────────────
#[contracttype]
pub enum DataKey {
    // Instance tier
    Admin,
    PendingAdmin,
    Token,
    /// Address where collected premiums are sent.
    Treasury,
    PremiumTable,
    CalcAddress,
    AllowedAsset(Address),
    Voters,
    ClaimCounter,
    Paused,
    ActivePolicyCount(Address),
    // Persistent tier
    Policy(Address, u32),
    PolicyCounter(Address),
    Claim(u64),
    /// Temp key for open claim check (policy_holder, policy_id) -> bool
    OpenClaim(Address, u32),
    /// (claim_id, voter_address) → VoteOption; immutable after first write
    Vote(u64, Address),
    /// Snapshot of eligible voters captured at claim-filing time.
    ClaimVoters(u64),
    /// Last ledger at which `holder` filed a claim (rate-limit anchor).
    LastClaimLedger(Address),
}

// ── Instance bump ─────────────────────────────────────────────────────────────

pub fn has_open_claim(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage().instance().get(&DataKey::OpenClaim(holder.clone(), policy_id)).unwrap_or(false)
}

pub fn set_open_claim(env: &Env, holder: &Address, policy_id: u32, open: bool) {
    env.storage().instance().set(&DataKey::OpenClaim(holder.clone(), policy_id), &open);
}

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

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("contract not initialised: admin missing")
}

pub fn set_pending_admin(env: &Env, pending: &Address) {
    env.storage().instance().set(&DataKey::PendingAdmin, pending);
}

pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}

pub fn clear_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
}

// ── Token ─────────────────────────────────────────────────────────────────────
pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("contract not initialised: token missing")
}

// ── External calculator address ───────────────────────────────────────────────
pub fn set_calc_address(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::CalcAddress, addr);
}

pub fn get_calc_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::CalcAddress)
}

// ── Multiplier table ──────────────────────────────────────────────────────────
pub fn set_multiplier_table(env: &Env, table: &MultiplierTable) {
    env.storage().instance().set(&DataKey::PremiumTable, table);
}

use crate::types::MultiplierTable;

pub fn set_multiplier_table(env: &Env, table: &MultiplierTable) {
    env.storage().instance().set(&DataKey::PremiumTable, table);
}

pub fn get_multiplier_table(env: &Env) -> MultiplierTable {
    env.storage().instance().get(&DataKey::PremiumTable).expect("multiplier table missing")
}

// ── Allowed assets ────────────────────────────────────────────────────────────
pub fn set_allowed_asset(env: &Env, asset: &Address, allowed: bool) {
    env.storage()
        .instance()
        .set(&DataKey::AllowedAsset(asset.clone()), &allowed);
}

pub fn is_allowed_asset(env: &Env, asset: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::AllowedAsset(asset.clone()))
        .unwrap_or(false)
}

// ── Claim (persistent) ────────────────────────────────────────────────────────
pub fn set_claim(env: &Env, claim: &Claim) {
    env.storage()
        .persistent()
        .set(&DataKey::Claim(claim.claim_id), claim);
    env.storage().persistent().extend_ttl(
        &DataKey::Claim(claim.claim_id),
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_EXTEND_TO,
    );
}

pub fn get_claim(env: &Env, claim_id: u64) -> Option<Claim> {
    env.storage().persistent().get(&DataKey::Claim(claim_id))
}

pub fn next_claim_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic!("claim_id overflow"));
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}

pub fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
}

// ── Vote (persistent) ─────────────────────────────────────────────────────────
pub fn set_vote(env: &Env, claim_id: u64, voter: &Address, vote: &VoteOption) {
    let key = DataKey::Vote(claim_id, voter.clone());
    env.storage().persistent().set(&key, vote);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_vote(env: &Env, claim_id: u64, voter: &Address) -> Option<VoteOption> {
    env.storage()
        .persistent()
        .get(&DataKey::Vote(claim_id, voter.clone()))
}

// ── Claim voter snapshot ──────────────────────────────────────────────────────

/// Capture the current live voter set as the immutable electorate for `claim_id`.
pub fn snapshot_claim_voters(env: &Env, claim_id: u64) {
    let voters = get_voters(env);
    let key = DataKey::ClaimVoters(claim_id);
    env.storage().persistent().set(&key, &voters);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_claim_voters(env: &Env, claim_id: u64) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimVoters(claim_id))
        .unwrap_or_else(|| Vec::new(env))
}

// ── Rate-limit anchor ─────────────────────────────────────────────────────────

pub fn set_last_claim_ledger(env: &Env, holder: &Address, ledger: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::LastClaimLedger(holder.clone()), &ledger);
}

pub fn get_last_claim_ledger(env: &Env, holder: &Address) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::LastClaimLedger(holder.clone()))
}

// ── Policy counter (persistent) ───────────────────────────────────────────────
pub fn get_policy_counter(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyCounter(holder.clone()))
        .unwrap_or(0u32)
}

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


// ═════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER STORAGE HELPERS (experimental only)
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: These functions are non-operational
// stubs.  They panic in default builds and must NOT be called until:
//   • Regulatory classification is complete
//   • Legal review approves automatic trigger-to-claim flow
//   • Game-theoretic safeguards are implemented
//   • Cryptographic signature verification is designed and audited
//
// PRODUCTION SAFETY: Default builds (without `experimental` feature)
// will panic if any of these functions are called, ensuring oracle
// triggers cannot be processed accidentally.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(feature = "experimental")]
use crate::types::{OracleTrigger, TriggerStatus};

/// Returns whether oracle triggers are globally enabled.
///
/// ⚠️  DEFAULT IS FALSE: Oracle triggers must be explicitly enabled by admin
/// after completing all required reviews (see DESIGN-ORACLE.md).
#[cfg(feature = "experimental")]
pub fn is_oracle_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::OracleEnabled)
        .unwrap_or(false)
}

/// Enable or disable oracle triggers globally.
///
/// ⚠️  ADMIN ACTION REQUIRED: This should remain false until:
///   • Cryptographic design review is complete
///   • Legal/compliance has approved parametric triggers
///   • Game-theoretic safeguards are implemented
#[cfg(feature = "experimental")]
pub fn set_oracle_enabled(env: &Env, enabled: bool) {
    env.storage().instance().set(&DataKey::OracleEnabled, &enabled);
}

/// Returns the next trigger_id and increments the counter.
///
/// ⚠️  PRODUCTION NOTE: Trigger ID generation must include replay protection.
/// Current implementation is a placeholder.
#[cfg(feature = "experimental")]
pub fn next_trigger_id(env: &Env) -> u64 {
    let key = DataKey::TriggerCounter;
    let next: u64 = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or(0u64)
        + 1;
    env.storage().instance().set(&key, &next);
    next
}

/// Store an oracle trigger.
///
/// ⚠️  SECURITY: Signature verification must be performed BEFORE calling
/// this function.  See validate_oracle_trigger() in validate.rs.
#[cfg(feature = "experimental")]
pub fn set_oracle_trigger(env: &Env, trigger_id: u64, trigger: &OracleTrigger) {
    env.storage()
        .persistent()
        .set(&DataKey::OracleTrigger(trigger_id), trigger);
}

/// Retrieve an oracle trigger by ID.
#[cfg(feature = "experimental")]
pub fn get_oracle_trigger(env: &Env, trigger_id: u64) -> Option<OracleTrigger> {
    env.storage()
        .persistent()
        .get(&DataKey::OracleTrigger(trigger_id))
}

/// Update trigger status.
#[cfg(feature = "experimental")]
pub fn set_trigger_status(env: &Env, trigger_id: u64, status: TriggerStatus) {
    env.storage()
        .persistent()
        .set(&DataKey::TriggerStatus(trigger_id), &status);
}

/// Get trigger status.
#[cfg(feature = "experimental")]
pub fn get_trigger_status(env: &Env, trigger_id: u64) -> Option<TriggerStatus> {
    env.storage()
        .persistent()
        .get(&DataKey::TriggerStatus(trigger_id))
}

// ═════════════════════════════════════════════════════════════════════════════
// STUB IMPLEMENTATIONS FOR DEFAULT (NON-EXPERIMENTAL) BUILDS
//
// These functions ensure that default builds CANNOT process oracle triggers.
// If called in a non-experimental build, they will panic at runtime.
// This is intentional: it creates a hard failure mode that prevents accidental
// oracle trigger processing in production.
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(not(feature = "experimental"))]
use crate::types::{OracleTrigger, TriggerStatus};

/// Stub: Panics in default builds to prevent oracle trigger processing.
///
/// ⚠️  DO NOT REMOVE THIS FUNCTION.  It ensures production safety by
/// creating a compile-time guarantee that oracle triggers cannot be
/// processed without the experimental feature flag.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn is_oracle_enabled(_env: &Env) -> bool {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger processing is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_oracle_enabled(_env: &Env, _enabled: bool) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger processing is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn next_trigger_id(_env: &Env) -> u64 {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger ID generation is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_oracle_trigger(_env: &Env, _trigger_id: u64, _trigger: &OracleTrigger) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger storage is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn get_oracle_trigger(_env: &Env, _trigger_id: u64) -> Option<OracleTrigger> {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger retrieval is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn set_trigger_status(_env: &Env, _trigger_id: u64, _status: TriggerStatus) {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger status updates are not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
}

/// Stub: Panics in default builds.
#[cfg(not(feature = "experimental"))]
#[allow(dead_code)]
pub fn get_trigger_status(_env: &Env, _trigger_id: u64) -> Option<TriggerStatus> {
    panic!(
        "ORACLE_TRIGGERS_DISABLED: Oracle trigger status retrieval is not enabled in this build. \
         Default production builds cannot process oracle triggers. \
         See DESIGN-ORACLE.md for activation requirements."
    )
// ── Pause flag ───────────────────────────────────────────────────────────────

pub fn get_policy(env: &Env, holder: &Address, policy_id: u32) -> Option<Policy> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(holder.clone(), policy_id))
}

// ── Pause flag ────────────────────────────────────────────────────────────────
pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

// ── Voter registry ────────────────────────────────────────────────────────────
pub fn get_voters(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Voters)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_voters(env: &Env, voters: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Voters, voters);
}

pub fn add_voter(env: &Env, holder: &Address) {
    let mut voters = get_voters(env);
    let mut found = false;
    for v in voters.iter() {
        if v == *holder {
            found = true;
            break;
        }
    }
    if !found {
        voters.push_back(holder.clone());
    }
    set_voters(env, &voters);

    let key = DataKey::ActivePolicyCount(holder.clone());
    let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(count + 1));
}

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

pub fn get_active_policy_count(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ActivePolicyCount(holder.clone()))
        .unwrap_or(0)

}
