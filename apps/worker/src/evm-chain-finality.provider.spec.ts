import { EvmChainFinalityProvider } from './evm-chain-finality.provider';

describe('EvmChainFinalityProvider', () => {
  const claim = {
    jobId: 'job-1',
    withdrawalId: 'withdrawal-1',
    providerTransferId: 'transfer-1',
    leaseToken: 'lease-1',
    verificationRequired: true,
    networkCode: 'SEPOLIA',
    addressFamily: 'EVM',
    destinationAddress: '0x1111111111111111111111111111111111111111',
    principalAtomic: 25n,
  };
  const responses = [
    {
      result: {
        status: '0x1',
        blockNumber: '0x64',
        blockHash: '0xblock',
        to: claim.destinationAddress,
        logs: [],
      },
    },
    { result: { to: claim.destinationAddress, value: '0x19' } },
    { result: '0x66' },
  ];

  it('independently matches a successful native transfer and confirmations', async () => {
    const fetcher = jest.fn();
    for (const body of responses) {
      fetcher.mockResolvedValueOnce({ ok: true, json: async () => body });
    }
    const provider = new EvmChainFinalityProvider(
      new Map([['SEPOLIA', 'https://rpc.example']]),
      fetcher as typeof fetch,
      5000,
      () => new Date('2026-09-08T12:00:00.000Z'),
    );

    await expect(provider.observe(claim, '0xabc')).resolves.toEqual({
      source: 'CHAIN_RPC',
      txHash: '0xabc',
      blockHash: '0xblock',
      blockNumber: 100n,
      confirmationCount: 3,
      executionSucceeded: true,
      destinationMatches: true,
      amountMatches: true,
      assetMatches: true,
      networkMatches: true,
      observedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
  });

  it('reports a wrong destination as negative evidence', async () => {
    const fetcher = jest.fn();
    for (const body of [
      responses[0],
      { result: { to: '0x2222222222222222222222222222222222222222', value: '0x19' } },
      responses[2],
    ]) {
      fetcher.mockResolvedValueOnce({ ok: true, json: async () => body });
    }
    const provider = new EvmChainFinalityProvider(
      new Map([['SEPOLIA', 'https://rpc.example']]),
      fetcher as typeof fetch,
    );
    await expect(provider.observe(claim, '0xabc')).resolves.toEqual(
      expect.objectContaining({ destinationMatches: false, amountMatches: true }),
    );
  });

  it('fails closed when the network has no configured RPC', async () => {
    const provider = new EvmChainFinalityProvider(new Map());
    await expect(provider.observe(claim, '0xabc')).rejects.toMatchObject({
      code: 'CHAIN_RPC_NOT_CONFIGURED',
    });
  });
});
