import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(name: string, fallback: string, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

@Injectable()
export class SendazaWebhookConfiguration {
  readonly url = this.parseUrl(required('SLE_SENDAZA_WEBHOOK_URL'));
  readonly secret = this.parseSecret(required('SLE_SENDAZA_WEBHOOK_SECRET'));
  readonly timeoutMs = boundedInteger('SLE_SENDAZA_WEBHOOK_TIMEOUT_MS', '5000', 100, 30_000);
  readonly pollIntervalMs = boundedInteger('SLE_OUTBOX_POLL_INTERVAL_MS', '1000', 100, 60_000);

  private parseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('SLE_SENDAZA_WEBHOOK_URL must be a valid URL');
    }
    const localDevelopment =
      process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localDevelopment) {
      throw new Error('SLE_SENDAZA_WEBHOOK_URL must use HTTPS');
    }
    if (url.username || url.password || url.hash) {
      throw new Error('SLE_SENDAZA_WEBHOOK_URL cannot contain credentials or a fragment');
    }
    return url.toString();
  }

  private parseSecret(value: string): string {
    if (Buffer.byteLength(value, 'utf8') < 32) {
      throw new Error('SLE_SENDAZA_WEBHOOK_SECRET must contain at least 32 bytes');
    }
    return value;
  }
}
