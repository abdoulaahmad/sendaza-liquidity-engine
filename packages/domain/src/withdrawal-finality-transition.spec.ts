import { nextWithdrawalFinalityStatus } from './withdrawal-finality';

describe('nextWithdrawalFinalityStatus', () => {
  const observedAt = new Date('2026-09-08T12:00:00.000Z');

  it('does not treat Fireblocks completion as confirmation when chain verification is required', () => {
    expect(
      nextWithdrawalFinalityStatus(
        'BROADCASTED',
        { source: 'FIREBLOCKS_POLL', providerStatus: 'COMPLETED', observedAt },
        true,
        3,
      ),
    ).toBe('CONFIRMING');
  });

  it('confirms only complete matching chain evidence at the threshold', () => {
    const evidence = {
      source: 'CHAIN_RPC' as const,
      txHash: '0xabc',
      confirmationCount: 3,
      executionSucceeded: true,
      destinationMatches: true,
      amountMatches: true,
      assetMatches: true,
      networkMatches: true,
      observedAt,
    };
    expect(nextWithdrawalFinalityStatus('CONFIRMING', evidence, true, 3)).toBe('CONFIRMED');
    expect(
      nextWithdrawalFinalityStatus('CONFIRMING', { ...evidence, confirmationCount: 2 }, true, 3),
    ).toBe('CONFIRMING');
  });

  it('routes any independent evidence mismatch to reconciliation', () => {
    expect(
      nextWithdrawalFinalityStatus(
        'CONFIRMING',
        {
          source: 'CHAIN_RPC',
          txHash: '0xabc',
          confirmationCount: 20,
          executionSucceeded: true,
          destinationMatches: false,
          amountMatches: true,
          assetMatches: true,
          networkMatches: true,
          observedAt,
        },
        true,
        3,
      ),
    ).toBe('RECONCILIATION_REQUIRED');
  });

  it('requires positive reverted execution evidence for failed on chain', () => {
    expect(
      nextWithdrawalFinalityStatus(
        'BROADCASTED',
        {
          source: 'CHAIN_RPC',
          txHash: '0xabc',
          executionSucceeded: false,
          destinationMatches: true,
          amountMatches: true,
          assetMatches: true,
          networkMatches: true,
          observedAt,
        },
        true,
        3,
      ),
    ).toBe('FAILED_ON_CHAIN');
  });
});
