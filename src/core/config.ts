import type { ConnectorConfig } from './types.js';

export interface AppConfig {
  enabled: string[];
  transport: 'stdio' | 'http';
  httpPort?: number;
  httpToken?: string;
  connectors: Record<string, ConnectorConfig>;
}

function lowerCamel(key: string): string {
  return key.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function groupConnector(prefix: string): ConnectorConfig {
  const out: ConnectorConfig = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(prefix)) {
      out[lowerCamel(k.slice(prefix.length))] = v;
    }
  }
  return out;
}

export function loadConfig(): AppConfig {
  const enabled = (process.env.SAP_ENABLED_CONNECTORS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const transport = (process.env.SAP_TRANSPORT ?? 'stdio') as 'stdio' | 'http';
  const connectors: Record<string, ConnectorConfig> = {};
  for (const id of enabled) {
    connectors[id] = groupConnector(`SAP_${id.toUpperCase()}_`);
  }
  return {
    enabled,
    transport,
    httpPort: process.env.SAP_HTTP_PORT ? Number(process.env.SAP_HTTP_PORT) : undefined,
    httpToken: process.env.SAP_HTTP_AUTH_TOKEN,
    connectors,
  };
}
