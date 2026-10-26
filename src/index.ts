import { loadConfig } from './core/config.js';
import { Registry } from './core/registry.js';
import { startServer } from './core/server.js';
import { createSacConnector } from './connectors/sac/index.js';
import { createAdtConnector } from './connectors/adt/index.js';
import { createRfcConnector } from './connectors/rfc/index.js';
import { logger } from './core/utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = new Registry();
  const enabled = new Set(config.enabled);
  if (enabled.has('rfc')) registry.register(createRfcConnector());
  if (enabled.has('sac')) registry.register(createSacConnector());
  if (enabled.has('adt')) registry.register(createAdtConnector());
  await registry.initAll(config.connectors);
  await startServer(registry, config);
}

main().catch((err) => {
  logger.error({ err: String(err) }, 'fatal');
  process.exit(1);
});
