import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_OPERATION = 'sle:idempotent-operation';
export const IdempotentOperation = (operation: string): MethodDecorator =>
  SetMetadata(IDEMPOTENT_OPERATION, operation);
