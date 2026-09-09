import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WithdrawalConfiguration } from '../../../packages/configuration/src';
import { WithdrawalPollingFinalityBatchService } from '../../../packages/domain/src';

@Injectable()
export class WithdrawalFinalityWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalFinalityWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly batches: WithdrawalPollingFinalityBatchService,
    private readonly configuration: WithdrawalConfiguration,
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
    const result = await this.batches.processBatch(new Date());
    if (result.claimed > 0)
      this.logger.log(
        `Withdrawal finality batch claimed=${result.claimed} observed=${result.observed} retried=${result.retried}`,
      );
  }
  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      const active = this.run();
      this.active = active;
      void active.finally(() => {
        if (this.active === active) this.active = undefined;
      });
    }, delayMs);
  }
  private async run(): Promise<void> {
    try {
      await this.processOnce();
    } catch {
      this.logger.error('Withdrawal finality batch failed; polling will resume');
    } finally {
      this.schedule(this.configuration.finalityPollIntervalMs);
    }
  }
}
