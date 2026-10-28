import type { ZodRawShape } from 'zod';

export type ConnectorConfig = Record<string, unknown>;

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'json'; json: unknown }>;
  isError?: boolean;
}

export interface ToolRegistration {
  name: string;                 // WITHOUT the sap.<id>. prefix; registry adds it
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: unknown, ctx?: unknown) => Promise<ToolResult>;
  /** Explicit write marker; when set, overrides the name-pattern heuristic. */
  write?: boolean;
}

export interface SapConnector {
  id: string;                                  // connector namespace segment
  init(config: ConnectorConfig): Promise<void>;
  tools(): ToolRegistration[];
  shutdown?(): Promise<void>;
}
