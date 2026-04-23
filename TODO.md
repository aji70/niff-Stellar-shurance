# Implementation TODO — Four Backend Issues

## Branch 1: blackboxai/356-ipfs-provider-fallback
- [ ] Create branch from main
- [ ] Create `ipfs-provider-chain.service.ts` with multi-gateway fallback + health checks
- [ ] Update `ipfs.service.ts` to use provider chain
- [ ] Update `ipfs.controller.ts` health check endpoint
- [ ] Update `ipfs.module.ts` to register provider chain
- [ ] Add `web3storage-ipfs.provider.ts` as additional provider
- [ ] Add unit tests `ipfs-provider-chain.service.spec.ts`
- [ ] Commit and push

## Branch 2: blackboxai/354-claim-rate-limiting
- [ ] Create branch from main
- [ ] Update `rate-limit.constants.ts` with wallet/global keys
- [ ] Update `rate-limit.service.ts` with per-wallet + global sliding window
- [ ] Update `rate-limit.guard.ts` to apply wallet/global checks and Retry-After header
- [ ] Update `rate-limit.exception.ts` to include retryAfterSeconds
- [ ] Add unit tests
- [ ] Update docs
- [ ] Commit and push

## Branch 3: blackboxai/335-claim-aggregation-service
- [ ] Create branch from main
- [ ] Create `claim-aggregation.service.ts`
- [ ] Update `claims.module.ts` to register service
- [ ] Update `claims.service.ts` to enrich responses
- [ ] Update DTOs with aggregated fields
- [ ] Add unit tests with fixed fixtures
- [ ] Commit and push

## Branch 4: blackboxai/357-tenant-isolation
- [ ] Create branch from main
- [ ] Audit all Prisma queries in `claims.service.ts`
- [ ] Expand `tenant-filter.helper.ts` with lint utility
- [ ] Add property-based tests in `tenant-isolation.test.ts`
- [ ] Add CI script `check-tenant-queries.ts`
- [ ] Update docs
- [ ] Commit and push

