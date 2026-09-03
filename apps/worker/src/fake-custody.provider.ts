import {
  CustodyBalanceEvidence,
  CustodyProvider,
  TreasurySyncTarget,
} from '../../../packages/domain/src';

export class DeterministicFakeCustodyProvider implements CustodyProvider {
  constructor(private readonly evidenceByWallet: ReadonlyMap<string, CustodyBalanceEvidence>) {}

  async getWalletBalance(target: TreasurySyncTarget): Promise<CustodyBalanceEvidence> {
    const evidence = this.evidenceByWallet.get(target.walletId);
    if (!evidence) throw new Error('FAKE_CUSTODY_WALLET_NOT_FOUND');
    return evidence;
  }
}
