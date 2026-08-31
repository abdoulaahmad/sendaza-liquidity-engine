import { Module } from '@nestjs/common';
import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { DatabaseModule } from '../../../packages/database/src';
import {
  OutboxDeliveryService,
  OutboxPublisher,
  OutboxRepository,
} from '../../../packages/domain/src';
import { OutboxWorker } from './outbox.worker';
import { SendazaWebhookPublisher } from './sendaza-webhook.publisher';

@Module({
  imports: [DatabaseModule],
  providers: [
    SendazaWebhookConfiguration,
    SendazaWebhookPublisher,
    { provide: OutboxPublisher, useExisting: SendazaWebhookPublisher },
    {
      provide: OutboxDeliveryService,
      useFactory: (repository: OutboxRepository, publisher: OutboxPublisher) =>
        new OutboxDeliveryService(repository, publisher),
      inject: [OutboxRepository, OutboxPublisher],
    },
    OutboxWorker,
  ],
})
export class WorkerModule {}
