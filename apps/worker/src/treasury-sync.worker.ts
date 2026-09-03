import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TreasurySyncConfiguration } from '../../../packages/configuration/src';
import { TreasurySyncBatchResult, TreasurySyncBatchService } from '../../../packages/domain/src';

@Injectable()
export class TreasurySyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TreasurySyncWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly batches: TreasurySyncBatchService,
    private readonly configuration: TreasurySyncConfiguration,
  ) {}

  onModuleInit(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  processOnce(): Promise<TreasurySyncBatchResult> {
    return this.batches.processBatch(new Date(), randomUUID());
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      const active = this.runAndReschedule();
      this.active = active;
      void active.finally(() => {
        if (this.active === active) this.active = undefined;
      });
    }, delayMs);
  }

  private async runAndReschedule(): Promise<void> {
    try {
      const result = await this.processOnce();
      if (result.claimed > 0) {
        this.logger.log(
          `Treasury batch claimed=${result.claimed} synchronized=${result.synchronized} failed=${result.failed}`,
        );
      }
    } catch {
      this.logger.error('Treasury synchronization batch failed; polling will resume');
    } finally {
      this.schedule(this.configuration.pollIntervalMs);
    }
  }
}
