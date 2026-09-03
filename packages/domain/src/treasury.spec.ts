import {
  ChainBalanceProvider,
  ChainBalanceProviderResolver,
  CustodyProvider,
  CustodyProviderResolver,
  TreasurySnapshotEvidence,
  TreasuryEvidenceError,
  TreasuryRepository,
  TreasurySynchronizationService,
  TreasurySyncTarget,
} from './treasury';

describe('TreasurySynchronizationService', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');
  const target: TreasurySyncTarget = {
    walletId: 'wallet-1',
    assetNetworkId: 'eth-sepolia',
    networkCode: 'SEPOLIA',
    addressFamily: 'EVM',
    assetDecimals: 18,
    providerKind: 'DETERMINISTIC_FAKE',
    providerCode: 'fake',
    providerVaultId: 'vault-1',
    providerAssetId: 'ETH_TEST6',
    publicAddress: '0xAbC',
    verificationRequired: true,
    safetyBufferAtomic: 100_000_000_000_000_000n,
    gasReserveAtomic: 50_000_000_000_000_000n,
    staleAfterSeconds: 60,
  };
  const evidence = {
    total: '2.000000000000000000',
    available: '1.800000000000000000',
    pending: '0.100000000000000000',
    frozen: '0',
    locked: '0.100000000000000000',
    addresses: [{ address: '0xabc' }],
    observedAt: new Date('2026-09-02T11:59:30.000Z'),
    providerReference: 'block-100',
  };
  const getWalletBalance = jest.fn();
  const getConfirmedBalanceAtomic = jest.fn();
  const saveSnapshot = jest.fn();
  const repository: TreasuryRepository = {
    listSyncTargets: jest.fn().mockResolvedValue([target]),
    saveSnapshot,
  };
  const custody: CustodyProvider = { getWalletBalance };
  const custodyResolver: CustodyProviderResolver = { resolve: jest.fn(() => custody) };
  const chain: ChainBalanceProvider = { getConfirmedBalanceAtomic };
  const chainResolver: ChainBalanceProviderResolver = { resolve: jest.fn(() => chain) };
  const service = new TreasurySynchronizationService(
    repository,
    custodyResolver,
    chainResolver,
    () => now,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getWalletBalance.mockResolvedValue(evidence);
    getConfirmedBalanceAtomic.mockResolvedValue(2_000_000_000_000_000_000n);
    saveSnapshot.mockImplementation(async (snapshot: TreasurySnapshotEvidence) => ({
      ...snapshot,
      snapshotId: 'snapshot-1',
      reservedAtomic: 0n,
      allocatedAtomic: 0n,
      sellableAtomic:
        snapshot.verificationStatus === 'MISMATCH' || snapshot.verificationStatus === 'STALE'
          ? 0n
          : 1_650_000_000_000_000_000n,
    }));
  });

  it('publishes network-scoped sellable inventory after independent agreement', async () => {
    await expect(service.synchronize(target)).resolves.toEqual({
      walletId: 'wallet-1',
      snapshotId: 'snapshot-1',
      verificationStatus: 'MATCHED',
      sellableAtomic: 1_650_000_000_000_000_000n,
    });
    expect(saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        assetNetworkId: 'eth-sepolia',
        controlledAtomic: 2_000_000_000_000_000_000n,
        unavailableAtomic: 200_000_000_000_000_000n,
        safetyBufferAtomic: 100_000_000_000_000_000n,
        gasReserveAtomic: 50_000_000_000_000_000n,
      }) as TreasurySnapshotEvidence,
    );
  });

  it('fails closed when provider and network balances disagree', async () => {
    getConfirmedBalanceAtomic.mockResolvedValue(1_999_999_999_999_999_999n);
    await expect(service.synchronize(target)).resolves.toMatchObject({
      verificationStatus: 'MISMATCH',
      sellableAtomic: 0n,
    });
  });

  it('fails closed on stale evidence without querying the chain', async () => {
    getWalletBalance.mockResolvedValue({
      ...evidence,
      observedAt: new Date('2026-09-02T11:58:00.000Z'),
    });
    await expect(service.synchronize(target)).resolves.toMatchObject({
      verificationStatus: 'STALE',
      sellableAtomic: 0n,
    });
    expect(getConfirmedBalanceAtomic).not.toHaveBeenCalled();
  });

  it('rejects excess provider precision and does not persist it', async () => {
    getWalletBalance.mockResolvedValue({ ...evidence, total: '2.0000000000000000001' });
    await expect(service.synchronize(target)).rejects.toBeInstanceOf(TreasuryEvidenceError);
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a provider response for another public address', async () => {
    getWalletBalance.mockResolvedValue({ ...evidence, addresses: [{ address: '0xdef' }] });
    await expect(service.synchronize(target)).rejects.toMatchObject({
      code: 'PROVIDER_ADDRESS_MISMATCH',
    });
  });

  it('keeps non-EVM address comparison case-sensitive', async () => {
    getWalletBalance.mockResolvedValue({ ...evidence, addresses: [{ address: 'SoLabc' }] });
    await expect(
      service.synchronize({
        ...target,
        addressFamily: 'SOLANA',
        publicAddress: 'SoLAbc',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ADDRESS_MISMATCH' });
  });

  it('supports provider-only observation when independent verification is optional', async () => {
    await expect(
      service.synchronize({ ...target, verificationRequired: false }),
    ).resolves.toMatchObject({
      verificationStatus: 'UNVERIFIED',
      sellableAtomic: 1_650_000_000_000_000_000n,
    });
    expect(getConfirmedBalanceAtomic).not.toHaveBeenCalled();
  });
});
