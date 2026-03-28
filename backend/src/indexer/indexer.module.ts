import { Module } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import { IndexerWorker } from './indexer.worker';
import { PrismaModule } from '../prisma/prisma.module';
import { RpcModule } from '../rpc/rpc.module';
import { QuoteModule } from '../quote/quote.module';

@Module({
  imports: [PrismaModule, RpcModule, QuoteModule],
  providers: [IndexerService, IndexerWorker],
  exports: [IndexerService],
})
export class IndexerModule {}
