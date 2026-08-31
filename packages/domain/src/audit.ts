import { JsonValue } from './idempotency';

export interface AuditRecord {
  readonly actorType: 'SERVICE_CLIENT' | 'SYSTEM';
  readonly actorId: string;
  readonly correlationId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export abstract class AuditRepository {
  abstract record(entry: AuditRecord): Promise<void>;
}
