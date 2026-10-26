import type { SapConnector, ToolRegistration, ResourceRegistration, PromptRegistration, ConnectorConfig } from './types.js';
import { logger } from './utils/logger.js';

export class Registry {
  private connectors = new Map<string, SapConnector>();
  private healthy = new Set<string>();

  register(conn: SapConnector): void {
    this.connectors.set(conn.id, conn);
  }

  async initAll(configs: Record<string, ConnectorConfig>): Promise<void> {
    for (const [id, conn] of this.connectors) {
      try {
        await conn.init(configs[id] ?? {});
        this.healthy.add(id);
        logger.info({ connector: id }, 'connector initialized');
      } catch (err) {
        logger.warn({ connector: id, err: String(err) }, 'connector skipped');
      }
    }
  }

  allTools(): ToolRegistration[] {
    const out: ToolRegistration[] = [];
    for (const id of this.healthy) {
      const conn = this.connectors.get(id)!;
      for (const t of conn.tools()) out.push({ ...t, name: `sap.${id}.${t.name}` });
    }
    return out;
  }

  allResources(): ResourceRegistration[] {
    const out: ResourceRegistration[] = [];
    for (const id of this.healthy) {
      const conn = this.connectors.get(id)!;
      if (conn.resources) for (const r of conn.resources()) out.push(r);
    }
    return out;
  }

  allPrompts(): PromptRegistration[] {
    const out: PromptRegistration[] = [];
    for (const id of this.healthy) {
      const conn = this.connectors.get(id)!;
      if (conn.prompts) for (const p of conn.prompts()) out.push(p);
    }
    return out;
  }
}
