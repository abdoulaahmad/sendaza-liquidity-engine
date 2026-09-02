import { TreasurySyncTarget } from '../../../packages/domain/src';
import { EvmChainBalanceProvider } from './evm-chain-balance.provider';

describe('EvmChainBalanceProvider', () => {
  const target = {
    publicAddress: '0x00000000000000000000000000000000000000ab',
  } as TreasurySyncTarget;

  it('reads a native balance as an exact bigint', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1bc16d674ec80000' }), {
        status: 200,
      }),
    );
    const provider = new EvmChainBalanceProvider('https://rpc.example', fetcher);
    await expect(provider.getConfirmedBalanceAtomic(target)).resolves.toBe(
      2_000_000_000_000_000_000n,
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ method: 'eth_getBalance' });
  });

  it('uses ERC-20 balanceOf for configured token contracts', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x64' }), { status: 200 }),
      );
    const provider = new EvmChainBalanceProvider('https://rpc.example', fetcher);
    await expect(
      provider.getConfirmedBalanceAtomic({
        ...target,
        contractAddress: '0x00000000000000000000000000000000000000cd',
      }),
    ).resolves.toBe(100n);
    const request = JSON.parse(fetcher.mock.calls[0]![1].body) as {
      method: string;
      params: [{ data: string }];
    };
    expect(request.method).toBe('eth_call');
    expect(request.params[0].data).toBe(`0x70a08231${'ab'.padStart(64, '0')}`);
  });

  it('rejects malformed JSON-RPC quantities', async () => {
    const provider = new EvmChainBalanceProvider(
      'https://rpc.example',
      jest.fn().mockResolvedValue(new Response(JSON.stringify({ result: '2.0' }), { status: 200 })),
    );
    await expect(provider.getConfirmedBalanceAtomic(target)).rejects.toThrow(
      'CHAIN_PROVIDER_RESPONSE_INVALID',
    );
  });
});
