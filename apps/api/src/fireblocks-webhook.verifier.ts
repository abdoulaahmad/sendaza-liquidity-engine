import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FireblocksWebhookConfiguration } from '../../../packages/configuration/src';
import { CustodyWebhookError, CustodyWebhookSignatureVerifier } from '../../../packages/domain/src';

type FetchLike = typeof fetch;
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string };

@Injectable()
export class FireblocksWebhookVerifier implements CustodyWebhookSignatureVerifier {
  private keys = new Map<string, Jwk>();
  private cacheExpiresAt = 0;

  constructor(
    private readonly configuration: FireblocksWebhookConfiguration,
    private readonly fetcher: FetchLike = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async verify(rawBody: Uint8Array, detachedJws: string): Promise<{ keyId: string }> {
    const parts = detachedJws.split('.');
    if (parts.length !== 3 || !parts[0] || parts[1] !== '' || !parts[2]) {
      throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID');
    }
    const header = protectedHeader(parts[0]);
    let key = await this.key(header.kid, false);
    if (!key) key = await this.key(header.kid, true);
    if (!key) throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNING_KEY_UNKNOWN');

    const signingInput = parts[0] + '.' + Buffer.from(rawBody).toString('base64url');
    let valid: boolean;
    try {
      valid = verify(
        'RSA-SHA512',
        Buffer.from(signingInput, 'ascii'),
        createPublicKey({ key, format: 'jwk' }),
        Buffer.from(parts[2], 'base64url'),
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID');
    return { keyId: header.kid };
  }

  private async key(kid: string, forceRefresh: boolean): Promise<Jwk | undefined> {
    if (forceRefresh || this.clock().getTime() >= this.cacheExpiresAt) await this.refresh();
    return this.keys.get(kid);
  }

  private async refresh(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.configuration.jwksTimeoutMs);
    try {
      const response = await this.fetcher(this.configuration.jwksUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new CustodyWebhookError('FIREBLOCKS_JWKS_UNAVAILABLE');
      const payload = (await response.json()) as unknown;
      if (!isRecord(payload) || !Array.isArray(payload.keys)) {
        throw new CustodyWebhookError('FIREBLOCKS_JWKS_INVALID');
      }
      const keys = new Map<string, Jwk>();
      for (const candidate of payload.keys) {
        if (
          isRecord(candidate) &&
          candidate.kty === 'RSA' &&
          candidate.use === 'sig' &&
          candidate.alg === 'RS512' &&
          typeof candidate.kid === 'string' &&
          candidate.kid.length > 0 &&
          candidate.kid.length <= 150 &&
          typeof candidate.n === 'string' &&
          typeof candidate.e === 'string'
        ) {
          keys.set(candidate.kid, candidate as Jwk);
        }
      }
      if (keys.size === 0) throw new CustodyWebhookError('FIREBLOCKS_JWKS_INVALID');
      this.keys = keys;
      this.cacheExpiresAt =
        this.clock().getTime() +
        cacheSeconds(response, this.configuration.maximumJwksCacheSeconds) * 1000;
    } catch (error: unknown) {
      if (error instanceof CustodyWebhookError) throw error;
      throw new CustodyWebhookError('FIREBLOCKS_JWKS_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}

function protectedHeader(encoded: string): { alg: 'RS512'; kid: string } {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID');
  }
  if (
    !isRecord(value) ||
    value.alg !== 'RS512' ||
    typeof value.kid !== 'string' ||
    value.kid.length === 0 ||
    value.kid.length > 150 ||
    value.crit !== undefined
  ) {
    throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID');
  }
  return { alg: 'RS512', kid: value.kid };
}

function cacheSeconds(response: Response, maximum: number): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
  if (!match) return maximum;
  const advertised = Number.parseInt(match[1] ?? '', 10);
  return Number.isSafeInteger(advertised) ? Math.max(60, Math.min(advertised, maximum)) : maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
