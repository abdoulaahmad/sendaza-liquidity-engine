import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NetworkFeeConfiguration } from '../../../packages/configuration/src';
import { NetworkFeeRefreshBatchService } from '../../../packages/domain/src';

@Injectable()
export class NetworkFeeRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NetworkFeeRefreshWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly batches: NetworkFeeRefreshBatchService,
    private readonly configuration: NetworkFeeConfiguration,
  ) {}

  onModuleInit(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  async processOnce(): Promise<void> {
    const result = await this.batches.processBatch(new Date(), randomUUID());
    if (result.claimed > 0) {
      this.logger.log(
        `Network fee batch claimed=${result.claimed} accepted=${result.accepted} rejected=${result.rejected} failed=${result.failed}`,
      );
    }
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
      await this.processOnce();
    } catch {
      this.logger.error('Network fee refresh batch failed; polling will resume');
    } finally {
      this.schedule(this.configuration.pollIntervalMs);
    }
  }
}
