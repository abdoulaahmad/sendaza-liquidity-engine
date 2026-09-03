import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WithdrawalConfiguration } from '../../../packages/configuration/src';
import { WithdrawalRecoveryBatchService } from '../../../packages/domain/src';

@Injectable()
export class WithdrawalRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalRecoveryWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly batches: WithdrawalRecoveryBatchService,
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
    if (result.checked > 0) {
      this.logger.log(
        `Withdrawal recovery checked=${result.checked} submitted=${result.resolvedSubmitted} failed=${result.resolvedFailed} stillUnknown=${result.stillUnknown}`,
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
      this.logger.error('Withdrawal recovery batch failed; polling will resume');
    } finally {
      this.schedule(this.configuration.recoveryPollIntervalMs);
    }
  }
}
