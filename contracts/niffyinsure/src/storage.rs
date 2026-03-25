use soroban_sdk::{contracttype, Address, Env, Vec};
use crate::types::{Claim, VoteOption};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    /// (holder, policy_id) — policy_id is per-holder u32
    Policy(Address, u32),
    /// Per-holder policy counter; next policy_id = counter + 1
    PolicyCounter(Address),
    Claim(u64),
    /// (claim_id, voter_address) → VoteOption
    Vote(u64, Address),
    /// Vec<Address> of all current active policyholders (voters)
    Voters,
    /// Global monotonic claim id counter
    ClaimCounter,
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Used by initialize and admin drain (feat/admin).
#[allow(dead_code)]
pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

/// Used by claim payout (feat/claim-voting).
#[allow(dead_code)]
pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

/// Returns the next policy_id for `holder` and increments the counter.
/// Used by feat/policy-lifecycle.
#[allow(dead_code)]
pub fn next_policy_id(env: &Env, holder: &Address) -> u32 {
    let key = DataKey::PolicyCounter(holder.clone());
    let next: u32 = env.storage().persistent().get(&key).unwrap_or(0) + 1;
    env.storage().persistent().set(&key, &next);
    next
}

/// Returns the next global claim_id and increments the counter.
/// Used by feat/claim-voting.
#[allow(dead_code)]
pub fn next_claim_id(env: &Env) -> u64 {
    let next: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
        + 1;
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}

pub fn get_claim_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64)
}

pub fn get_policy_counter(env: &Env, holder: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::PolicyCounter(holder.clone()))
        .unwrap_or(0u32)
}


pub fn has_policy(env: &Env, holder: &Address, policy_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Policy(holder.clone(), policy_id))
}

pub fn get_claim(env: &Env, claim_id: &u64) -> Claim {
    env.storage().instance().get(&DataKey::Claim(*claim_id)).unwrap()
}

pub fn put_claim(env: &Env, claim_id: &u64, claim: &Claim) {
    env.storage().instance().set(&DataKey::Claim(*claim_id), claim);
}

pub fn has_vote(env: &Env, claim_id: &u64, voter: &Address) -> bool {
    env.storage().instance().has(&DataKey::Vote(*claim_id, voter.clone()))
}

pub fn record_vote(env: &Env, claim_id: &u64, voter: &Address, vote: &VoteOption) {
    env.storage().instance().set(&DataKey::Vote(*claim_id, voter.clone()), vote);
}

pub fn get_votes_count(_env: &Env, _claim_id: &u64) -> u32 {
    0 // stub, extend with counter later
}

pub fn get_voters(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&DataKey::Voters).unwrap_or_else(|| Vec::new(env))
}

pub fn get_voters_len(env: &Env) -> u32 {
    get_voters(env).len() as u32
}

#[allow(dead_code)]
pub fn set_voters(env: &Env, voters: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Voters, voters);
}

