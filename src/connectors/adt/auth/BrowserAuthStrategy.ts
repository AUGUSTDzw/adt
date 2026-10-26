import http from 'node:http';
import { spawn } from 'node:child_process';
import type { IAuthorizationStrategy, AuthorizationRequest, AuthorizationOutcome } from '@mcp-abap-adt/interfaces-auth';

/**
 * Browser-based authorization strategy for OAuth2 authorization_code flow.
 * Starts a local HTTP server to receive the OAuth2 callback, opens a browser,
 * and extracts the authorization code.
 */
export class BrowserAuthStrategy implements IAuthorizationStrategy<string> {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly logger: Console;

  constructor(port = 61001, logger?: Console) {
    this.port = port;
    this.logger = logger ?? console;
  }

  async authorize(request: AuthorizationRequest): Promise<AuthorizationOutcome<string>> {
    const redirectUri = `http://localhost:${this.port}/callback`;

    // Build the authorization URL
    const authUrl = await request.buildAuthorizationUrl(redirectUri);

    // Create a promise that resolves when the callback is received
    const codePromise = new Promise<string>((resolve, reject) => {
      let settled = false;

      this.server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Authorization failed</h1><p>${error}</p></body></html>`);
            if (!settled) {
              settled = true;
              reject(new Error(`Authorization failed: ${error}`));
            }
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Missing authorization code</h1></body></html>`);
            if (!settled) {
              settled = true;
              reject(new Error('Missing authorization code in callback'));
            }
            return;
          }

          // Success
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
            <body>
              <h1>Authentication successful!</h1>
              <p>You can close this window and return to your CLI tool.</p>
              <script>
                setTimeout(() => window.close(), 2000);
              </script>
            </body>
            </html>
          `);

          if (!settled) {
            settled = true;
            resolve(code);
          }

          // Close the server after a short delay
          setTimeout(() => {
            this.server?.close();
          }, 1000);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      // Handle server errors
      this.server.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Callback server error: ${err.message}`));
        }
      });

      // Start the server
      this.server.listen(this.port, () => {
        this.logger.log(`Authorization callback server listening on port ${this.port}`);
        this.logger.log(`Authorization URL: ${authUrl}`);
        this.logger.log('Opening browser for authentication...');

        // Open the browser
        this.openBrowser(authUrl);
      });

      // Handle abort signal
      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          if (!settled) {
            settled = true;
            reject(new Error('Authorization aborted'));
          }
        });
      }
    });

    const code = await codePromise;

    // Clean up the server
    this.server?.close();
    this.server = null;

    return {
      payload: code,
      redirectUri,
    };
  }

  private openBrowser(url: string): void {
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    try {
      spawn(command, args, {
        stdio: 'ignore',
        detached: true,
      });
    } catch (err) {
      this.logger.error(`Failed to open browser: ${err instanceof Error ? err.message : String(err)}`);
      this.logger.error(`Please open this URL manually: ${url}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }
}
