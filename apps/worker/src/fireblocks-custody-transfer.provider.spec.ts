import { generateKeyPairSync } from 'node:crypto';
import { FireblocksCustodyTransferProvider } from './fireblocks-custody-transfer.provider';

describe('FireblocksCustodyTransferProvider', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('submits with the server-resolved Fireblocks vault and asset identifiers', async () => {
    const fetcher = jest.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ id: 'fireblocks-id', status: 'SUBMITTED' }), {
        status: 200,
      });
    });
    const provider = new FireblocksCustodyTransferProvider(
      'api-key',
      privatePem,
      'https://sandbox-api.fireblocks.io',
      fetcher as typeof fetch,
    );

    await expect(
      provider.createTransfer({
        externalTxId: 'withdrawal-id',
        providerVaultId: 'vault-42',
        providerAssetId: 'USDT_TRX_TEST',
        destinationAddress: 'TAddress',
        amountAtomic: 1_500_000n,
        assetDecimals: 6,
      }),
    ).resolves.toEqual({ kind: 'ACCEPTED', providerTransferId: 'fireblocks-id' });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      externalTxId: 'withdrawal-id',
      assetId: 'USDT_TRX_TEST',
      source: { type: 'VAULT_ACCOUNT', id: 'vault-42' },
      destination: {
        type: 'ONE_TIME_ADDRESS',
        oneTimeAddress: { address: 'TAddress' },
      },
      amount: '1.500000',
    });
  });

  it('uses the documented external_tx_id lookup endpoint', async () => {
    const fetcher = jest.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        'https://sandbox-api.fireblocks.io/v1/transactions/external_tx_id/withdrawal-id',
      );
      return new Response('', { status: 404 });
    });
    const provider = new FireblocksCustodyTransferProvider(
      'api-key',
      privatePem,
      'https://sandbox-api.fireblocks.io',
      fetcher as typeof fetch,
    );

    await expect(provider.findTransferByExternalTxId('withdrawal-id')).resolves.toEqual({
      kind: 'UNKNOWN',
    });
  });

  it('keeps provider terminal statuses out of the pre-broadcast-safe category', async () => {
    const fetcher = jest.fn(
      async () =>
        new Response(JSON.stringify({ id: 'fireblocks-id', status: 'FAILED' }), { status: 200 }),
    );
    const provider = new FireblocksCustodyTransferProvider(
      'api-key',
      privatePem,
      'https://sandbox-api.fireblocks.io',
      fetcher as typeof fetch,
    );

    await expect(provider.findTransferByExternalTxId('withdrawal-id')).resolves.toEqual({
      kind: 'TERMINAL_FAILURE',
      reasonCode: 'FAILED',
    });
  });
});
