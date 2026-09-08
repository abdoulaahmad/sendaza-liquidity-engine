import { Injectable } from '@nestjs/common';

const JWKS_URLS = {
  US: 'https://keys.fireblocks.io/.well-known/jwks.json',
  EU: 'https://eu-keys.fireblocks.io/.well-known/jwks.json',
  EU2: 'https://eu2-keys.fireblocks.io/.well-known/jwks.json',
  SANDBOX: 'https://sandbox-keys.fireblocks.io/.well-known/jwks.json',
} as const;

type FireblocksEnvironment = keyof typeof JWKS_URLS;

function integer(name: string, fallback: string, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(name + ' must be an integer');
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) throw new Error(name + ' is outside its safe range');
  return value;
}

@Injectable()
export class FireblocksWebhookConfiguration {
  readonly environment: FireblocksEnvironment;
  readonly jwksUrl: string;
  readonly maximumBodyBytes = integer(
    'SLE_FIREBLOCKS_WEBHOOK_MAX_BODY_BYTES',
    '100000',
    1024,
    100000,
  );
  readonly jwksTimeoutMs = integer('SLE_FIREBLOCKS_JWKS_TIMEOUT_MS', '5000', 100, 30000);
  readonly maximumJwksCacheSeconds = integer(
    'SLE_FIREBLOCKS_JWKS_MAX_CACHE_SECONDS',
    '3600',
    60,
    3600,
  );

  constructor() {
    const environment = process.env.SLE_FIREBLOCKS_WEBHOOK_ENVIRONMENT ?? 'SANDBOX';
    if (!(environment in JWKS_URLS)) throw new Error('SLE_FIREBLOCKS_WEBHOOK_ENVIRONMENT_INVALID');
    this.environment = environment as FireblocksEnvironment;
    this.jwksUrl = JWKS_URLS[this.environment];
  }
}
