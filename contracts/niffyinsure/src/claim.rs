use crate::{
    storage, token,
    types::{Claim, ClaimStatus, VoteOption},
    validate,
};
use soroban_sdk::{contracterror, contractevent, Address, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ClaimError {
    PolicyNotFound = 10,
    PolicyInactive = 11,
    PolicyExpired = 12,
    ClaimAmountZero = 13,
    ClaimExceedsCoverage = 14,
    DetailsTooLong = 15,
    TooManyImageUrls = 16,
    ImageUrlTooLong = 17,
    NotAVoter = 18,
    AlreadyVoted = 19,
    ClaimNotFound = 20,
    ClaimAlreadyTerminal = 21,
    ContractPaused = 22,
}

#[contractevent]
pub struct ClaimFiled {
    pub claim_id: u64,
    pub claimant: Address,
    pub policy_id: u32,
    pub amount: i128,
}

#[contractevent]
pub struct VoteLogged {
    pub claim_id: u64,
    pub voter: Address,
    pub approve_votes: u32,
    pub reject_votes: u32,
}

#[contractevent]
pub struct ClaimProcessed {
    pub claim_id: u64,
    pub status: ClaimStatus,
    pub payout: i128,
}

/// File a new claim against an active policy.
///
/// - Caller must be the policyholder.
/// - Policy must be active and not expired.
/// - Returns the new `claim_id`.
pub fn file_claim(
    env: &Env,
    holder: Address,
    policy_id: u32,
    amount: i128,
    details: String,
    image_urls: Vec<String>,
) -> Result<u64, ClaimError> {
    if storage::is_paused(env) {
        return Err(ClaimError::ContractPaused);
    }
    storage::bump_instance(env);

    holder.require_auth();

    let policy = storage::get_policy(env, &holder, policy_id).ok_or(ClaimError::PolicyNotFound)?;

    validate::check_policy_active(&policy, env.ledger().sequence()).map_err(|e| match e {
        validate::Error::PolicyInactive => ClaimError::PolicyInactive,
        validate::Error::PolicyExpired => ClaimError::PolicyExpired,
        _ => ClaimError::PolicyInactive,
    })?;

    validate::check_claim_fields(env, amount, policy.coverage, &details, &image_urls).map_err(
        |e| match e {
            validate::Error::ClaimAmountZero => ClaimError::ClaimAmountZero,
            validate::Error::ClaimExceedsCoverage => ClaimError::ClaimExceedsCoverage,
            validate::Error::DetailsTooLong => ClaimError::DetailsTooLong,
            validate::Error::TooManyImageUrls => ClaimError::TooManyImageUrls,
            validate::Error::ImageUrlTooLong => ClaimError::ImageUrlTooLong,
            _ => ClaimError::ClaimAmountZero,
        },
    )?;

    let claim_id = storage::next_claim_id(env);
    let claim = Claim {
        claim_id,
        policy_id,
        claimant: holder.clone(),
        amount,
        details,
        image_urls,
        status: ClaimStatus::Processing,
        approve_votes: 0,
        reject_votes: 0,
    };
    storage::set_claim(env, &claim);

    ClaimFiled {
        claim_id,
        claimant: holder,
        policy_id,
        amount,
    }
    .publish(env);

    Ok(claim_id)
}

/// Cast a vote on an open claim.
///
/// - `voter` must be in the active voter list.
/// - Each voter may vote at most once per claim.
/// - On majority (> 50 % of total voters) the claim is finalised immediately.
pub fn vote_on_claim(
    env: &Env,
    voter: Address,
    claim_id: u64,
    vote: VoteOption,
) -> Result<ClaimStatus, ClaimError> {
    if storage::is_paused(env) {
        return Err(ClaimError::ContractPaused);
    }
    storage::bump_instance(env);

    voter.require_auth();

    let voters = storage::get_voters(env);
    if !voters.iter().any(|v| v == voter) {
        return Err(ClaimError::NotAVoter);
    }

    let mut claim = storage::get_claim(env, claim_id).ok_or(ClaimError::ClaimNotFound)?;

    validate::check_claim_open(&claim).map_err(|_| ClaimError::ClaimAlreadyTerminal)?;

    if storage::get_vote(env, claim_id, &voter).is_some() {
        return Err(ClaimError::AlreadyVoted);
    }

    storage::set_vote(env, claim_id, &voter, &vote);

    match vote {
        VoteOption::Approve => claim.approve_votes += 1,
        VoteOption::Reject => claim.reject_votes += 1,
    }

    VoteLogged {
        claim_id,
        voter: voter.clone(),
        approve_votes: claim.approve_votes,
        reject_votes: claim.reject_votes,
    }
    .publish(env);

    let majority = voters.len() / 2 + 1;

    if claim.approve_votes >= majority {
        claim.status = ClaimStatus::Approved;
        storage::set_claim(env, &claim);
        let token = storage::get_token(env);
        let contract_addr = env.current_contract_address();
        token::transfer(env, &token, &contract_addr, &claim.claimant, claim.amount);
        ClaimProcessed {
            claim_id,
            status: ClaimStatus::Approved,
            payout: claim.amount,
        }
        .publish(env);
    } else if claim.reject_votes >= majority {
        claim.status = ClaimStatus::Rejected;
        storage::set_claim(env, &claim);
        ClaimProcessed {
            claim_id,
            status: ClaimStatus::Rejected,
            payout: 0,
        }
        .publish(env);
    } else {
        storage::set_claim(env, &claim);
    }

    Ok(claim.status)
}
