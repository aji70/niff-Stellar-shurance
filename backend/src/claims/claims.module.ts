import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { SanitizationService } from './sanitization.service';
import { ClaimViewMapper } from './claim-view.mapper';
import { ClaimAggregationService } from './services/claim-aggregation.service';
import { RpcModule } from '../rpc/rpc.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantModule } from '../tenant/tenant.module';
import { IndexerModule } from '../indexer/indexer.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [RpcModule, RateLimitModule, TenantModule, IndexerModule, CacheModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, SanitizationService, ClaimViewMapper, ClaimAggregationService],
  exports: [ClaimsService, ClaimViewMapper, ClaimAggregationService],
})
export class ClaimsModule {}
