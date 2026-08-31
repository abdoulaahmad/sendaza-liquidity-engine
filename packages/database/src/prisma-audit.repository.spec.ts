import { PrismaAuditRepository } from './prisma-audit.repository';
import { PrismaService } from './prisma.service';

describe('PrismaAuditRepository', () => {
  it('persists only the supplied safe audit fields', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const repository = new PrismaAuditRepository({
      auditLog: { create },
    } as unknown as PrismaService);
    await repository.record({
      actorType: 'SERVICE_CLIENT',
      actorId: 'sendaza-core',
      correlationId: '00000000-0000-4000-8000-000000000001',
      action: 'api.request.completed',
      resourceType: 'api_operation',
      resourceId: 'purchases.create',
      metadata: { method: 'POST', statusCode: 201, outcome: 'SUCCESS' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: 'SERVICE_CLIENT',
        actorId: 'sendaza-core',
        correlationId: '00000000-0000-4000-8000-000000000001',
        action: 'api.request.completed',
        resourceType: 'api_operation',
        resourceId: 'purchases.create',
        metadata: { method: 'POST', statusCode: 201, outcome: 'SUCCESS' },
      },
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain('signature');
  });
});
