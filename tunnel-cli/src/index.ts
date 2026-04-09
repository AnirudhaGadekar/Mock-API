#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';
import { TunnelClient } from './tunnel-client.js';

const program = new Command();
const DEFAULT_PRODUCTION_SERVER = 'wss://api.mockapi.online/tunnel-ws';

function resolveDefaultServerUrl(): string {
    const configuredServer = process.env.MOCKAPI_TUNNEL_SERVER?.trim();
    if (configuredServer) {
        return configuredServer;
    }

    return DEFAULT_PRODUCTION_SERVER;
}

const defaultServerUrl = resolveDefaultServerUrl();

program
    .name('mockapi')
    .description('Expose localhost to the internet via MockAPI tunnel')
    .version('1.0.0');

program
    .command('tunnel')
    .description('Start a tunnel to expose localhost')
    .option('-p, --port <port>', 'Local port to tunnel', '3000')
    .option('-s, --subdomain <subdomain>', 'Preferred subdomain (optional)')
    .option('-h, --host <host>', 'Local host (default: localhost)', 'localhost')
    .requiredOption('-k, --key <apiKey>', 'API key for authentication')
    .option('--server <server>', 'Tunnel server URL (or set MOCKAPI_TUNNEL_SERVER)', defaultServerUrl)
    .option('--no-log', 'Disable request logging')
    .action(async (options: any) => {
        const serverUrl = options.server;

        console.log(chalk.blue(`Targeting server: ${serverUrl}`));

        const client = new TunnelClient({
            serverUrl,
            localPort: parseInt(options.port),
            localHost: options.host,
            preferredSubdomain: options.subdomain,
            apiKey: options.key,
            enableLogging: options.log
        });

        try {
            await client.connect();
        } catch (error: any) {
            console.error(chalk.red('Failed to connect:'), error.message);
            process.exit(1);
        }
    });

program.parse();
