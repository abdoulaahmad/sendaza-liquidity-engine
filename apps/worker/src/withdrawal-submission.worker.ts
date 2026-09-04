import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WithdrawalConfiguration } from '../../../packages/configuration/src';
import { WithdrawalSubmissionBatchService } from '../../../packages/domain/src';

@Injectable()
export class WithdrawalSubmissionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalSubmissionWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly batches: WithdrawalSubmissionBatchService,
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
    const result = await this.batches.processBatch(new Date(), randomUUID());
    if (result.claimed > 0) {
      this.logger.log(
        `Withdrawal submission batch claimed=${result.claimed} submitted=${result.submitted} failed=${result.failed} unknown=${result.unknown}`,
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
      this.logger.error('Withdrawal submission batch failed; polling will resume');
    } finally {
      this.schedule(this.configuration.submissionPollIntervalMs);
    }
  }
}
