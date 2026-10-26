import pino from 'pino';
export const logger = pino({ name: 'sap-mcp', level: process.env.SAP_LOG_LEVEL ?? 'info' });
