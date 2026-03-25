use soroban_sdk::{contracterror, Env, Address, String, Vec, Symbol, token};
use crate::storage as st;
use crate::types::*;
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ClaimNotProcessing = 1,
    VotingDeadlineNotPassed = 2,
    NoActiveVoters = 3,
    NoEligiblePayout = 4,
    AlreadyVoted = 5,
    InvalidVote = 6,
    PolicyNotFound = 7,
    PolicyInactive = 8,
    InvalidClaimant = 9,
    InvalidAmount = 10,
    DetailsTooLong = 11,
    TooManyImages = 12,
    ImageTooLong = 13,
    InvalidDuration = 14,
}

pub fn file_claim(
    env: Env,
    holder: Address,
    policy_id: u32,
    amount: i128,
    details: String,
    image_urls: Vec<String>,
    vote_duration_ledgers: u32,
) -> Result<u64, Error> {
    // Stub policy check - in full, load Policy, check is_active, claimant==holder, amount <= coverage
    if !st::has_policy(&env, &holder, policy_id) {
        return Err(Error::PolicyNotFound);
    }
    // Stub active check
    if !validate::check_policy_active_stub(&env, &holder, policy_id) {
        return Err(Error::PolicyInactive);
    }
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if details.len() as u32 > DETAILS_MAX_LEN {
        return Err(Error::DetailsTooLong);
    }
    if image_urls.len() as u32 > IMAGE_URLS_MAX {
        return Err(Error::TooManyImages);
    }
    for url in image_urls.iter() {
        if url.len() as u32 > IMAGE_URL_MAX_LEN {
            return Err(Error::ImageTooLong);
        }
    }
    if vote_duration_ledgers == 0 {
        return Err(Error::InvalidDuration);
    }
    let current_ledger = env.ledger().sequence();
    let deadline = current_ledger + vote_duration_ledgers;
    let claim_id = st::next_claim_id(&env);
    let claim = Claim {
        claim_id,
        policy_id,
        claimant: holder.clone(),
        amount,
        details,
        image_urls,
        status: ClaimStatus::Processing,
        voting_deadline_ledger: deadline,
        approve_votes: 0,
        reject_votes: 0,
    };
    st::put_claim(&env, &claim_id, &claim);
    // TODO: emit claim filed event (quorum-ready)
    Ok(claim_id)
}

pub fn vote_on_claim(env: Env, voter: Address, claim_id: u64, vote: VoteOption) -> Result<(), Error> {
    let claim = st::get_claim(&env, &claim_id);
    if claim.status != ClaimStatus::Processing {
        return Err(Error::ClaimNotProcessing);
    }
    let current = env.ledger().sequence();
    if current < claim.voting_deadline_ledger {
        return Err(Error::VotingDeadlineNotPassed);
    }
    // Stub voter eligibility
    if !validate::check_voter_eligible_stub(&env, &voter) {
        return Err(Error::InvalidVote);
    }
    if st::has_vote(&env, &claim_id, &voter) {
        return Err(Error::AlreadyVoted);
    }
    st::record_vote(&env, &claim_id, &voter, &vote);
    let mut updated = claim.clone();
    match vote {
        VoteOption::Approve => updated.approve_votes += 1,
        VoteOption::Reject => updated.reject_votes += 1,
    };
    st::put_claim(&env, &claim_id, &updated);
    // TODO: emit vote cast event
    Ok(())
}

pub fn finalize_claim(env: Env, claim_id: u64) -> Result<(), Error> {
    let mut claim = st::get_claim(&env, &claim_id);
    if claim.status.is_terminal() {
        return Ok(()); // idempotent
    }
    let current_ledger = env.ledger().sequence();
    let eligible = st::get_voters_len(&env);
    if eligible == 0 {
        return Err(Error::NoActiveVoters);
    }
    let votes_cast = claim.approve_votes + claim.reject_votes; // using tallies as proxy
    let all_voted = votes_cast as u32 == eligible;
    let deadline_passed = current_ledger > claim.voting_deadline_ledger;
    if !all_voted && !deadline_passed {
        return Err(Error::VotingDeadlineNotPassed);
    }
    let prev_status = claim.status.clone();
    if claim.approve_votes * 2 > eligible {
        claim.status = ClaimStatus::Approved;
        let token = st::get_token(&env);
 token::Client::new(&env, &token).transfer(&claim.claimant, &claim.claimant, &claim.amount); // stub from claimant
    } else {
        claim.status = ClaimStatus::Rejected;
    }
    st::put_claim(&env, &claim_id, &claim);
    let status_event = (symbol_short!("status_changed"), claim_id);
    env.events().publish(status_event, (prev_status, claim.status.clone(), claim.approve_votes, claim.reject_votes, current_ledger));
    Ok(())
}

// Stubs for validation - full policy/validate impl later
mod claim_validate {
    use soroban_sdk::{Env, Address};
    pub fn check_policy_active_stub(_env: &Env, _holder: &Address, _policy_id: u32) -> bool {
        true // stub
    }
    pub fn check_voter_eligible_stub(_env: &Env, _voter: &Address) -> bool {
        true // stub
    }
}
use self::claim_validate as validate;

