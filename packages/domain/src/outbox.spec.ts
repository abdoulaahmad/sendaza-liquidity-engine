import { calculateOutboxRetryAt } from './outbox';

describe('calculateOutboxRetryAt', () => {
  const failedAt = new Date('2026-08-31T12:00:00.000Z');

  it.each([
    [1, '2026-08-31T12:00:05.000Z'],
    [2, '2026-08-31T12:00:10.000Z'],
    [4, '2026-08-31T12:00:40.000Z'],
    [20, '2026-08-31T12:05:00.000Z'],
  ])('uses bounded exponential retry for attempt %s', (attempt, expected) => {
    expect(calculateOutboxRetryAt(failedAt, attempt).toISOString()).toBe(expected);
  });

  it('rejects invalid attempt counts', () => {
    expect(() => calculateOutboxRetryAt(failedAt, 0)).toThrow('INVALID_ATTEMPT_COUNT');
  });
});
