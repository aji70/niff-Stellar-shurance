import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';
import { IndexerWorker } from './indexer.worker';
import { ReconciliationService } from './reconciliation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, RpcModule],
  providers: [IndexerService, IndexerWorker, ReconciliationService],
  exports: [IndexerService, ReconciliationService],
})
export class IndexerModule {}
