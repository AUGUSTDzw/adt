// Ambient shim so `npm run typecheck` passes without the optional `node-rfc`
// native dependency installed. The runtime import is guarded by a try/catch in
// sap-client.ts; this declaration only satisfies the TypeScript compiler.
declare module 'node-rfc' {
  export interface ConnectionCallOptions {
    [key: string]: unknown;
  }
  export class Connection {
    constructor(connParams: Record<string, unknown>);
    call(fmName: string, params?: ConnectionCallOptions): Promise<unknown> | unknown;
    close?(): void;
  }
}
