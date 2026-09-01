import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PricingRefreshConfiguration } from '../../../packages/configuration/src';
import {
  PricingRefreshBatchResult,
  PricingRefreshBatchService,
} from '../../../packages/domain/src';

@Injectable()
export class PricingRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricingRefreshWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly batches: PricingRefreshBatchService,
    private readonly configuration: PricingRefreshConfiguration,
  ) {}

  onModuleInit(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  async processOnce(): Promise<PricingRefreshBatchResult> {
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
          `Pricing batch claimed=${result.claimed} refreshed=${result.refreshed} rejected=${result.rejected} retry=${result.retryScheduled}`,
        );
      }
    } catch {
      this.logger.error('Pricing refresh batch failed; polling will resume after the interval');
    } finally {
      this.schedule(this.configuration.pollIntervalMs);
    }
  }
}
