import type { IConfig, IConnectionConfig, IServiceKeyStore } from '@mcp-abap-adt/interfaces-auth-broker';
import type { IAuthorizationConfig } from '@mcp-abap-adt/interfaces-auth-sap';

/**
 * Service key store that reads from environment variables or config.
 * For single-destination setups, all config comes from env vars.
 */
export class EnvServiceKeyStore implements IServiceKeyStore {
  private readonly config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
  }

  async getServiceKey(destination: string): Promise<IConfig | null> {
    return this.getConnectionConfig(destination);
  }

  async getAuthorizationConfig(destination: string): Promise<IAuthorizationConfig | null> {
    const uaaUrl = String(this.config.uaaUrl ?? '');
    const uaaClientId = String(this.config.uaaClientId ?? this.config.clientId ?? '');
    const uaaClientSecret = String(this.config.uaaClientSecret ?? this.config.clientSecret ?? '');

    if (!uaaUrl || !uaaClientId || !uaaClientSecret) {
      return null;
    }

    return {
      uaaUrl,
      uaaClientId,
      uaaClientSecret,
    } as IAuthorizationConfig;
  }

  async getConnectionConfig(destination: string): Promise<IConnectionConfig | null> {
    const serviceUrl = String(this.config.baseUrl ?? '');
    if (!serviceUrl) return null;

    const config: IConnectionConfig = {
      serviceUrl,
      authType: (this.config.authMode as 'basic' | 'jwt' | 'saml' | 'snc') ?? 'jwt',
      grantType: (this.config.grantType as 'authorization_code' | 'client_credentials' | 'none') ?? 'authorization_code',
      sapClient: this.config.client ? String(this.config.client) : undefined,
      language: this.config.language ? String(this.config.language) : undefined,
    };

    return config;
  }

  async getClientCertificate(destination: string): Promise<import('@mcp-abap-adt/interfaces-auth-broker').IClientCertificate | null> {
    return null;
  }
}
