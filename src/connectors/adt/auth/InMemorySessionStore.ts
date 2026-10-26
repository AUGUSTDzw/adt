import type { IConfig, IConnectionConfig } from '@mcp-abap-adt/interfaces-auth-broker';
import type { IAuthorizationConfig } from '@mcp-abap-adt/interfaces-auth-sap';

/**
 * In-memory session store for SSO tokens.
 * Stores tokens and refresh tokens in memory for the lifetime of the process.
 */
export class InMemorySessionStore {
  private sessions = new Map<string, IConfig>();

  async loadSession(destination: string): Promise<IConfig | null> {
    return this.sessions.get(destination) ?? null;
  }

  async saveSession(destination: string, config: IConfig | unknown): Promise<void> {
    this.sessions.set(destination, config as IConfig);
  }

  async deleteSession(destination: string): Promise<void> {
    this.sessions.delete(destination);
  }

  async getAuthorizationConfig(destination: string): Promise<IAuthorizationConfig | null> {
    const session = this.sessions.get(destination);
    if (!session) return null;
    return {
      uaaUrl: session.uaaUrl,
      uaaClientId: session.uaaClientId,
      uaaClientSecret: session.uaaClientSecret,
      refreshToken: session.refreshToken,
    } as IAuthorizationConfig;
  }

  async getConnectionConfig(destination: string): Promise<IConnectionConfig | null> {
    const session = this.sessions.get(destination);
    if (!session) return null;
    return session as IConnectionConfig;
  }

  async setAuthorizationConfig(destination: string, config: IAuthorizationConfig): Promise<void> {
    const existing = this.sessions.get(destination) ?? {};
    this.sessions.set(destination, {
      ...existing,
      ...config,
    } as IConfig);
  }

  async setConnectionConfig(destination: string, config: IConnectionConfig): Promise<void> {
    const existing = this.sessions.get(destination) ?? {};
    this.sessions.set(destination, {
      ...existing,
      ...config,
    } as IConfig);
  }
}
