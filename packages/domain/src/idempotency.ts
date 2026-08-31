import { sha256Hex } from './authentication';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export interface IdempotencyRequest {
  readonly clientId: string;
  readonly operation: string;
  readonly key: string;
  readonly method: string;
  readonly rawTarget: string;
  readonly rawBody: Uint8Array;
  readonly correlationId: string;
}

export interface IdempotencyIdentity {
  readonly clientId: string;
  readonly operation: string;
  readonly key: string;
  readonly requestHash: string;
  readonly correlationId: string;
}

export interface StoredIdempotencyResponse {
  readonly statusCode: number;
  readonly body: JsonValue;
}

export type IdempotencyDecision =
  | { readonly kind: 'ACQUIRED'; readonly recordId: string }
  | { readonly kind: 'REPLAY'; readonly response: StoredIdempotencyResponse }
  | { readonly kind: 'CONFLICT' }
  | { readonly kind: 'IN_PROGRESS' };

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;
const OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,99}$/;

export function validateIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(key);
}

export function createIdempotencyIdentity(request: IdempotencyRequest): IdempotencyIdentity {
  if (!OPERATION_PATTERN.test(request.operation)) throw new Error('INVALID_IDEMPOTENCY_OPERATION');
  if (!validateIdempotencyKey(request.key)) throw new Error('INVALID_IDEMPOTENCY_KEY');

  const canonical = [
    request.operation,
    request.clientId,
    request.method.toUpperCase(),
    request.rawTarget,
    sha256Hex(request.rawBody),
  ].join('\n');
  return {
    clientId: request.clientId,
    operation: request.operation,
    key: request.key,
    requestHash: sha256Hex(canonical),
    correlationId: request.correlationId,
  };
}

export abstract class IdempotencyRepository {
  abstract acquire(identity: IdempotencyIdentity): Promise<IdempotencyDecision>;
  abstract complete(
    recordId: string,
    requestHash: string,
    response: StoredIdempotencyResponse,
  ): Promise<void>;
}
