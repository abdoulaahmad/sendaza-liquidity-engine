import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { OutboxBatchResult, OutboxDeliveryService } from '../../../packages/domain/src';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly delivery: OutboxDeliveryService,
    private readonly configuration: SendazaWebhookConfiguration,
  ) {}

  onModuleInit(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  async processOnce(): Promise<OutboxBatchResult> {
    return this.delivery.processBatch(new Date(), randomUUID());
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
          `Outbox batch claimed=${result.claimed} delivered=${result.delivered} retry=${result.retryScheduled} quarantined=${result.quarantined}`,
        );
      }
    } catch {
      this.logger.error('Outbox batch failed; delivery will resume after the polling interval');
    } finally {
      this.schedule(this.configuration.pollIntervalMs);
    }
  }
}
