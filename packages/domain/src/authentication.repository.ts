import { AuthenticatedRequestContext, HmacCredential } from './authentication';

export type CredentialMetadata = Omit<HmacCredential, 'secret'>;

export abstract class CredentialMetadataRepository {
  abstract findByKeyId(keyId: string): Promise<CredentialMetadata | undefined>;
}

export abstract class AuthenticationNonceRepository {
  abstract claim(context: AuthenticatedRequestContext): Promise<boolean>;
}
