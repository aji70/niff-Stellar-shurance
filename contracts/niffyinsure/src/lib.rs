#![no_std]

mod claim;
mod policy;
mod premium;
pub mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

#[contract]
pub struct NiffyInsure;

#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address.
    /// Must be called immediately after deployment.
    pub fn initialize(env: Env, admin: Address, token: Address) {
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
    }

    /// Pure quote path: reads config and computes premium only.
    /// This entrypoint intentionally performs no persistent writes.
    pub fn generate_premium(
        env: Env,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        age: u32,
        risk_score: u32,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, policy::QuoteError> {
        policy::generate_premium(
            &env,
            policy_type,
            region,
            age,
            risk_score,
            include_breakdown,
        )
    }

    /// Converts quote failure codes to support-friendly messages for API layers.
    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => policy::QuoteError::InvalidAge,
            2 => policy::QuoteError::InvalidRiskScore,
            3 => policy::QuoteError::InvalidQuoteTtl,
            _ => policy::QuoteError::ArithmeticOverflow,
        };
        policy::map_quote_error(&env, err)
    }

    /// File a claim against an active policy.
    /// Caller must be the policyholder; policy must be active and not expired.
    /// Returns the new claim_id.
    pub fn file_claim(
        env: Env,
        holder: Address,
        policy_id: u32,
        amount: i128,
        details: String,
        image_urls: Vec<String>,
    ) -> Result<u64, claim::ClaimError> {
        claim::file_claim(&env, holder, policy_id, amount, details, image_urls)
    }

    /// Cast a vote (Approve/Reject) on an open claim.
    /// Voter must hold an active policy. Returns the updated ClaimStatus.
    pub fn vote_on_claim(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
    ) -> Result<types::ClaimStatus, claim::ClaimError> {
        claim::vote_on_claim(&env, voter, claim_id, vote)
    }

    // ── Read-only helpers for monitoring / tests / ops tooling ───────────

    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn get_voters(env: Env) -> Vec<Address> {
        storage::get_voters(&env)
    }

    // ── Policy domain ────────────────────────────────────────────────────
    // initiate_policy, renew_policy, terminate_policy
    // implemented in policy.rs — issue: feat/policy-lifecycle

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain, set_paused
    // implemented in token.rs — issue: feat/admin
}
