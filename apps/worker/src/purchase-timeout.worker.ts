import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PurchaseConfiguration } from '../../../packages/configuration/src';
import { PurchaseTimeoutBatchService } from '../../../packages/domain/src';

@Injectable()
export class PurchaseTimeoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurchaseTimeoutWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly batches: PurchaseTimeoutBatchService,
    private readonly configuration: PurchaseConfiguration,
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
    if (result.claimed > 0)
      this.logger.log(
        `Purchase timeouts claimed=${result.claimed} reconciled=${result.reconciled}`,
      );
  }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      const active = this.run();
      this.active = active;
      void active.finally(() => {
        if (this.active === active) this.active = undefined;
      });
    }, delay);
  }
  private async run(): Promise<void> {
    try {
      await this.processOnce();
    } catch {
      this.logger.error('Purchase timeout batch failed; polling will resume');
    } finally {
      this.schedule(this.configuration.timeoutPollIntervalMs);
    }
  }
}
