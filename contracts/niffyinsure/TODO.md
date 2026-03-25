# Issue #13: finalize_claim implementation

Current branch: blackboxai/issue-13-finalize-claim

## Steps:
- [x] 1. git checkout -b blackboxai/issue-13-finalize-claim
- [x] 2. Update src/types.rs: Add voting_deadline_ledger: u32 to Claim struct
- [x] 3. Update src/storage.rs: Add helpers get_claim, put_claim, get_votes_count(claim_id)->u32, has_vote(claim_id, voter), record_vote(claim_id, voter, VoteOption), get_voters_len() -> u32
- [ ] 4. Implement src/claim.rs: file_claim(... vote_duration_ledgers: u32), vote_on_claim(claim_id, vote), finalize_claim(claim_id)
- [ ] 5. Update src/lib.rs: Add the 3 public entrypoints forwarding to claim::
- [ ] 6. cargo check + verify
- [ ] 7. git commit -am 'feat: implement finalize_claim with deadlines/quorum/terminal guards'

No tests per instructions.
