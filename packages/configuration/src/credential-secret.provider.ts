import { Injectable } from '@nestjs/common';

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

type CredentialSecretEntry = { readonly keyId: string; readonly secret: string };

@Injectable()
export class CredentialSecretProvider {
  private readonly secrets: ReadonlyMap<string, string>;

  constructor(serialized = process.env.SLE_SENDAZA_CREDENTIALS_JSON) {
    this.secrets = this.parse(serialized);
  }

  get(keyId: string): string | undefined {
    return this.secrets.get(keyId);
  }

  private parse(serialized: string | undefined): ReadonlyMap<string, string> {
    if (!serialized) throw new Error('SLE_SENDAZA_CREDENTIALS_JSON is required');
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error('SLE_SENDAZA_CREDENTIALS_JSON must be valid JSON');
    }
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 2) {
      throw new Error('SLE_SENDAZA_CREDENTIALS_JSON must contain one or two credentials');
    }
    const secrets = new Map<string, string>();
    for (const value of parsed) {
      if (!this.isEntry(value))
        throw new Error('SLE_SENDAZA_CREDENTIALS_JSON contains an invalid credential');
      if (secrets.has(value.keyId))
        throw new Error('SLE_SENDAZA_CREDENTIALS_JSON contains duplicate key IDs');
      secrets.set(value.keyId, value.secret);
    }
    return secrets;
  }

  private isEntry(value: unknown): value is CredentialSecretEntry {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return (
      Object.keys(entry).length === 2 &&
      typeof entry.keyId === 'string' &&
      KEY_ID_PATTERN.test(entry.keyId) &&
      typeof entry.secret === 'string' &&
      Buffer.byteLength(entry.secret, 'utf8') >= 32
    );
  }
}
