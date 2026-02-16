#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';
import { TunnelClient } from './tunnel-client.js';

const program = new Command();

program
    .name('beeceptor')
    .description('Expose localhost to the internet via Beeceptor tunnel')
    .version('1.0.0');

program
    .command('tunnel')
    .description('Start a tunnel to expose localhost')
    .option('-p, --port <port>', 'Local port to tunnel', '3000')
    .option('-s, --subdomain <subdomain>', 'Preferred subdomain (optional)')
    .option('-h, --host <host>', 'Local host (default: localhost)', 'localhost')
    .option('-k, --key <apiKey>', 'API key for authentication')
    .option('--server <server>', 'Tunnel server URL', 'ws://localhost:10000/tunnel-ws')
    .option('--no-log', 'Disable request logging')
    .action(async (options: any) => {
        // Determine the server URL
        // If running in dev/local, default to ws://localhost:10000
        // In prod, it should default to wss://api.mockurl.com/tunnel-ws
        const serverUrl = options.server || 'ws://localhost:10000/tunnel-ws';

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
