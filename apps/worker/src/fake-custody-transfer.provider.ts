import { randomUUID } from 'node:crypto';
import {
  CustodyTransferOutcome,
  CustodyTransferProvider,
  CustodyTransferRequest,
} from '../../../packages/domain/src';

/**
 * Deterministic sandbox transfer adapter. Keyed by externalTxId so repeated
 * createTransfer calls for the same withdrawal are idempotent, matching the
 * real Fireblocks externalTxId contract.
 */
export class DeterministicFakeCustodyTransferProvider implements CustodyTransferProvider {
  private readonly transfersByExternalTxId = new Map<string, CustodyTransferOutcome>();

  async createTransfer(request: CustodyTransferRequest): Promise<CustodyTransferOutcome> {
    const existing = this.transfersByExternalTxId.get(request.externalTxId);
    if (existing) return existing;
    const outcome: CustodyTransferOutcome = {
      kind: 'ACCEPTED',
      providerTransferId: randomUUID(),
    };
    this.transfersByExternalTxId.set(request.externalTxId, outcome);
    return outcome;
  }

  async findTransferByExternalTxId(externalTxId: string): Promise<CustodyTransferOutcome> {
    return this.transfersByExternalTxId.get(externalTxId) ?? { kind: 'UNKNOWN' };
  }
}
