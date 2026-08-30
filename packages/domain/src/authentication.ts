import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type AuthenticationErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_CREDENTIAL'
  | 'INVALID_SIGNATURE'
  | 'STALE_REQUEST'
  | 'INVALID_NONCE';

export class AuthenticationError extends Error {
  constructor(readonly code: AuthenticationErrorCode) {
    super(code);
    this.name = 'AuthenticationError';
  }
}

export interface HmacCredential {
  readonly id: string;
  readonly keyId: string;
  readonly clientId: string;
  readonly secret: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly validFrom: Date;
  readonly validUntil?: Date;
}

export interface SignedRequest {
  readonly method: string;
  readonly rawTarget: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly signature: string;
  readonly rawBody: Uint8Array;
}

export interface AuthenticatedRequestContext {
  readonly credentialId: string;
  readonly credentialKeyId: string;
  readonly clientId: string;
  readonly nonceHash: string;
  readonly nonceExpiresAt: Date;
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function sha256Hex(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalizeSignedRequest(request: SignedRequest): string {
  return [
    request.method.toUpperCase(),
    request.rawTarget,
    request.timestamp,
    request.nonce,
    sha256Hex(request.rawBody),
  ].join('\n');
}

export function signRequest(request: Omit<SignedRequest, 'signature'>, secret: string): string {
  return createHmac('sha256', secret)
    .update(canonicalizeSignedRequest({ ...request, signature: '' }))
    .digest('base64url');
}

export class HmacAuthenticator {
  constructor(private readonly timestampWindowSeconds = 300) {}

  authenticate(
    request: SignedRequest,
    credential: HmacCredential | undefined,
    now = new Date(),
  ): AuthenticatedRequestContext {
    if (!credential || credential.keyId.length === 0) {
      throw new AuthenticationError('INVALID_CREDENTIAL');
    }
    if (
      credential.status !== 'ACTIVE' ||
      credential.validFrom.getTime() > now.getTime() ||
      (credential.validUntil !== undefined && credential.validUntil.getTime() <= now.getTime())
    ) {
      throw new AuthenticationError('INVALID_CREDENTIAL');
    }
    if (!NONCE_PATTERN.test(request.nonce)) {
      throw new AuthenticationError('INVALID_NONCE');
    }

    const timestamp = new Date(request.timestamp);
    if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== request.timestamp) {
      throw new AuthenticationError('STALE_REQUEST');
    }
    const windowMilliseconds = this.timestampWindowSeconds * 1000;
    if (Math.abs(now.getTime() - timestamp.getTime()) > windowMilliseconds) {
      throw new AuthenticationError('STALE_REQUEST');
    }
    if (!SIGNATURE_PATTERN.test(request.signature)) {
      throw new AuthenticationError('INVALID_SIGNATURE');
    }

    const expectedBytes = Buffer.from(signRequest(request, credential.secret), 'base64url');
    const suppliedBytes = Buffer.from(request.signature, 'base64url');
    if (
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw new AuthenticationError('INVALID_SIGNATURE');
    }

    return {
      credentialId: credential.id,
      credentialKeyId: credential.keyId,
      clientId: credential.clientId,
      nonceHash: sha256Hex(request.nonce),
      nonceExpiresAt: new Date(timestamp.getTime() + windowMilliseconds),
    };
  }
}
