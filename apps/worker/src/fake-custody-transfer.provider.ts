import { randomUUID } from 'node:crypto';
import {
  CustodyFinalityProvider,
  CustodyTransferOutcome,
  CustodyTransferProvider,
  CustodyTransferRequest,
  WithdrawalFinalityEvidence,
} from '../../../packages/domain/src';

export class DeterministicFakeCustodyTransferProvider
  implements CustodyTransferProvider, CustodyFinalityProvider
{
  private readonly transfersByExternalTxId = new Map<string, CustodyTransferOutcome>();
  private readonly transfersByProviderId = new Map<string, string>();

  async createTransfer(request: CustodyTransferRequest): Promise<CustodyTransferOutcome> {
    const existing = this.transfersByExternalTxId.get(request.externalTxId);
    if (existing) return existing;
    const providerTransferId = randomUUID();
    const outcome: CustodyTransferOutcome = { kind: 'ACCEPTED', providerTransferId };
    this.transfersByExternalTxId.set(request.externalTxId, outcome);
    this.transfersByProviderId.set(providerTransferId, request.externalTxId);
    return outcome;
  }

  async findTransferByExternalTxId(externalTxId: string): Promise<CustodyTransferOutcome> {
    return this.transfersByExternalTxId.get(externalTxId) ?? { kind: 'UNKNOWN' };
  }

  async getTransfer(providerTransferId: string): Promise<WithdrawalFinalityEvidence | null> {
    const externalTxId = this.transfersByProviderId.get(providerTransferId);
    if (!externalTxId) return null;
    return {
      source: 'FIREBLOCKS_POLL',
      providerStatus: 'BROADCASTING',
      txHash: '0x' + externalTxId.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
      observedAt: new Date(),
    };
  }
}
