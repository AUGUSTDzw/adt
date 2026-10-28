export const logger = {
  info: (...a: unknown[]) => console.log('[sap-mcp]', ...a),
  warn: (...a: unknown[]) => console.warn('[sap-mcp]', ...a),
  error: (...a: unknown[]) => console.error('[sap-mcp]', ...a),
};
