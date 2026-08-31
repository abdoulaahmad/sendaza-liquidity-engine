import { SetMetadata } from '@nestjs/common';

export const AUDIT_OPERATION = 'sle:audit-operation';
export const AuditOperation = (operation: string): MethodDecorator =>
  SetMetadata(AUDIT_OPERATION, operation);
