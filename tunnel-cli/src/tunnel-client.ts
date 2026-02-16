
import axios from 'axios';
import boxen from 'boxen';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import WebSocket from 'ws';

interface TunnelConfig {
    serverUrl: string;
    localPort: number;
    localHost: string;
    preferredSubdomain?: string;
    apiKey?: string;
    enableLogging: boolean;
}

interface ProxiedRequest {
    type: 'REQUEST';
    requestId: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string; // string or JSON string
}

export class TunnelClient {
    private config: TunnelConfig;
    private ws: WebSocket | null = null;
    private tunnelId?: string;
    private publicUrl?: string;
    private requestCount = 0;
    private spinner?: Ora;

    constructor(config: TunnelConfig) {
        this.config = config;
    }

    async connect(): Promise<void> {
        this.spinner = ora('Connecting to Beeceptor tunnel server...').start();

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.config.serverUrl);

            this.ws.on('open', () => {
                this.ws?.send(JSON.stringify({
                    type: 'CONNECT',
                    tunnelId: this.config.preferredSubdomain,
                    apiKey: this.config.apiKey
                }));
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());

                    if (msg.type === 'CONNECTED') {
                        this.tunnelId = msg.tunnelId;
                        this.publicUrl = msg.publicUrl;
                        this.spinner?.succeed('Tunnel connected!');
                        this.displayInfo();
                        resolve();
                    } else if (msg.type === 'REQUEST') {
                        this.handleRequest(msg as ProxiedRequest);
                    } else if (msg.type === 'ERROR') {
                        this.spinner?.fail(msg.message);
                        reject(new Error(msg.message));
                    }
                } catch (err) {
                    console.error('Failed to parse message', err);
                }
            });

            this.ws.on('error', (err) => {
                this.spinner?.fail('Connection failed');
                reject(err);
            });

            this.ws.on('close', () => {
                console.log(chalk.yellow('\nTunnel connection closed'));
                process.exit(0);
            });
        });
    }

    private displayInfo(): void {
        const info = boxen(
            chalk.bold.cyan('Tunnel Active\n\n') +
            chalk.white(`Public URL:  ${chalk.green(this.publicUrl)}\n`) +
            chalk.white(`Forwarding:  ${chalk.yellow(`http://${this.config.localHost}:${this.config.localPort}`)}\n\n`) +
            chalk.dim('Press Ctrl+C to stop'),
            {
                padding: 1,
                margin: 1,
                borderStyle: 'round',
                borderColor: 'cyan'
            }
        );
        console.log(info);
    }

    private async handleRequest(request: ProxiedRequest): Promise<void> {
        this.requestCount++;
        const startTime = Date.now();

        try {
            const targetUrl = `http://${this.config.localHost}:${this.config.localPort}${request.path}`;

            const response = await axios({
                method: request.method,
                url: targetUrl,
                headers: request.headers,
                data: request.body,
                validateStatus: () => true, // Accept any status
                responseType: 'arraybuffer' // handle binary
            });

            const duration = Date.now() - startTime;

            // Convert headers to Record<string, string>
            const responseHeaders: Record<string, string> = {};
            Object.entries(response.headers).forEach(([key, val]) => {
                responseHeaders[key] = String(val);
            });

            const responsePayload = {
                type: 'RESPONSE',
                requestId: request.requestId,
                status: response.status,
                headers: responseHeaders,
                body: Buffer.from(response.data).toString('base64')
            };

            this.ws?.send(JSON.stringify(responsePayload));

            if (this.config.enableLogging) {
                this.logRequest(request.method, request.path, response.status, duration);
            }

        } catch (error: any) {
            // Send error response back to tunnel
            const errorPayload = {
                type: 'RESPONSE',
                requestId: request.requestId,
                status: 502,
                headers: {},
                body: Buffer.from(`Bad Gateway - ${error.message}`).toString('base64')
            };
            this.ws?.send(JSON.stringify(errorPayload));

            if (this.config.enableLogging) {
                console.log(
                    chalk.red(`[${new Date().toLocaleTimeString()}]`),
                    chalk.bold(request.method),
                    request.path,
                    chalk.red('→ ERROR'),
                    chalk.dim(error.message)
                );
            }
        }
    }

    private logRequest(method: string, path: string, status: number, duration: number): void {
        const statusColor = status < 300 ? chalk.green : status < 400 ? chalk.yellow : chalk.red;
        const methodColor = method === 'GET' ? chalk.blue :
            method === 'POST' ? chalk.green :
                method === 'PUT' ? chalk.yellow :
                    method === 'DELETE' ? chalk.red : chalk.white;

        console.log(
            chalk.dim(`[${new Date().toLocaleTimeString()}]`),
            methodColor.bold(method.padEnd(7)),
            path.padEnd(40),
            statusColor(`${status}`),
            chalk.dim(`(${duration}ms)`)
        );
    }
}
