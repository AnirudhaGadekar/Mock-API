# Detailed Implementation Prompts for Missing Features

---

## Feature #8: Local Tunneling CLI Tool

### Overview
Build a command-line tool that connects to your existing tunnel-proxy backend and exposes localhost services to public HTTPS endpoints.

### Backend Enhancement (tunnel-proxy)

#### 1. WebSocket Tunnel Server

```typescript
// src/plugins/tunnel-ws.ts
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

interface TunnelSession {
  tunnelId: string;
  socketId: string;
  userId: string;
  localHost: string;
  localPort: number;
  createdAt: Date;
  requestCount: number;
  ws: WebSocket;
  pendingRequests: Map<string, (response: ProxiedResponse) => void>;
}

interface TunnelConnectPayload {
  localPort: number;
  localHost?: string;
  preferredSubdomain?: string;
}

interface ProxiedRequest {
  id: string;
  method: string;
  path: string;
  queryString?: string;
  headers: Record<string, string[]>;
  body?: string; // Base64 encoded
}

interface ProxiedResponse {
  id: string;
  statusCode: number;
  headers: Record<string, string[]>;
  body?: string; // Base64 encoded
}

const ADJECTIVES = ['happy', 'quick', 'bright', 'calm', 'fierce'];
const NOUNS = ['tiger', 'river', 'forest', 'cloud', 'stone'];

const activeTunnels = new Map<string, TunnelSession>();

function generateTunnelId(preferred?: string): string {
  if (preferred && !activeTunnels.has(preferred)) return preferred;
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${adj}-${noun}-${num}`;
}

export async function tunnelWsPlugin(fastify: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });

  fastify.server.on('upgrade', (request, socket, head) => {
    if (request.url === '/tunnel-ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws, request) => {
    const socketId = randomBytes(16).toString('hex');
    const userId = (request as any).user?.id ?? 'anonymous'; // Populated by auth middleware

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; payload: any };

        if (msg.type === 'tunnel/connect') {
          const payload = msg.payload as TunnelConnectPayload;
          const tunnelId = generateTunnelId(payload.preferredSubdomain);
          const publicUrl = `https://${tunnelId}.beeceptor.com`;

          const session: TunnelSession = {
            tunnelId,
            socketId,
            userId,
            localHost: payload.localHost ?? 'localhost',
            localPort: payload.localPort,
            createdAt: new Date(),
            requestCount: 0,
            ws,
            pendingRequests: new Map(),
          };

          activeTunnels.set(tunnelId, session);
          fastify.log.info(`Tunnel connected: ${publicUrl} -> localhost:${payload.localPort}`);

          ws.send(JSON.stringify({
            type: 'tunnel/connected',
            payload: { tunnelId, publicUrl, status: 'CONNECTED' },
          }));
        }

        if (msg.type === 'tunnel/response') {
          const response = msg.payload as ProxiedResponse;
          for (const session of activeTunnels.values()) {
            const resolve = session.pendingRequests.get(response.id);
            if (resolve) {
              resolve(response);
              session.pendingRequests.delete(response.id);
            }
          }
        }

        if (msg.type === 'tunnel/disconnect') {
          for (const [id, session] of activeTunnels.entries()) {
            if (session.socketId === socketId) {
              activeTunnels.delete(id);
              fastify.log.info(`Tunnel disconnected: ${id}`);
            }
          }
        }
      } catch (err) {
        fastify.log.error('Tunnel WS parse error', err);
      }
    });

    ws.on('close', () => {
      for (const [id, session] of activeTunnels.entries()) {
        if (session.socketId === socketId) {
          activeTunnels.delete(id);
        }
      }
    });
  });

  // Expose activeTunnels for the HTTP handler
  fastify.decorate('activeTunnels', activeTunnels);
}
```

#### 2. HTTP Request Handler (Public → Tunnel)

```typescript
// src/routes/tunnel-proxy.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';

const TUNNEL_TIMEOUT_MS = 30_000;

export async function tunnelProxyRoutes(fastify: FastifyInstance) {
  fastify.all('/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const host = request.headers.host ?? '';
    const tunnelId = host.split('.')[0];
    const activeTunnels: Map<string, any> = (fastify as any).activeTunnels;
    const session = activeTunnels.get(tunnelId);

    if (!session) {
      return reply
        .status(404)
        .send('Tunnel not found. Is the CLI tool running?');
    }

    const requestId = randomUUID();
    const body = (request.body as Buffer | null);

    const proxiedRequest = {
      id: requestId,
      method: request.method,
      path: request.url.split('?')[0],
      queryString: request.url.includes('?') ? request.url.split('?')[1] : undefined,
      headers: request.headers as Record<string, string[]>,
      body: body ? body.toString('base64') : undefined,
    };

    session.requestCount++;

    const responsePromise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('TIMEOUT')),
        TUNNEL_TIMEOUT_MS,
      );

      session.pendingRequests.set(requestId, (res: any) => {
        clearTimeout(timer);
        resolve(res);
      });

      session.ws.send(JSON.stringify({
        type: 'tunnel/request',
        payload: proxiedRequest,
      }));
    });

    try {
      const proxiedResponse = await responsePromise;
      const responseBody = proxiedResponse.body
        ? Buffer.from(proxiedResponse.body, 'base64')
        : Buffer.alloc(0);

      for (const [key, value] of Object.entries(proxiedResponse.headers ?? {})) {
        const v = Array.isArray(value) ? value.join(', ') : value;
        reply.header(key, v as string);
      }

      return reply.status(proxiedResponse.statusCode).send(responseBody);
    } catch (err: any) {
      if (err.message === 'TIMEOUT') {
        return reply.status(504).send('Gateway Timeout - Local server did not respond');
      }
      return reply.status(502).send('Bad Gateway');
    } finally {
      session.pendingRequests.delete(requestId);
    }
  });
}
```

### CLI Tool Implementation

#### `package.json`

```json
{
  "name": "@beeceptor/tunnel",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "beeceptor": "./dist/index.js",
    "bct": "./dist/index.js"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "ws": "^8.18.0",
    "axios": "^1.6.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.1",
    "boxen": "^7.1.1"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12",
    "typescript": "^5.0.0"
  }
}
```

#### `src/index.ts`

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { TunnelClient } from './tunnel-client.js';
import chalk from 'chalk';

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
  .option('--no-log', 'Disable request logging')
  .action(async (options) => {
    const client = new TunnelClient({
      serverUrl: 'wss://tunnel.beeceptor.com/tunnel-ws',
      localPort: parseInt(options.port, 10),
      localHost: options.host,
      preferredSubdomain: options.subdomain,
      apiKey: options.key,
      enableLogging: options.log,
    });

    try {
      await client.connect();
    } catch (error: any) {
      console.error(chalk.red('Failed to connect:'), error.message);
      process.exit(1);
    }
  });

program.parse();
```

#### `src/tunnel-client.ts`

```typescript
import WebSocket from 'ws';
import axios from 'axios';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import boxen from 'boxen';

interface TunnelConfig {
  serverUrl: string;
  localPort: number;
  localHost: string;
  preferredSubdomain?: string;
  apiKey?: string;
  enableLogging: boolean;
}

interface ProxiedRequest {
  id: string;
  method: string;
  path: string;
  queryString?: string;
  headers: Record<string, string[]>;
  body?: string; // Base64
}

export class TunnelClient {
  private ws?: WebSocket;
  private tunnelId?: string;
  private publicUrl?: string;
  private requestCount = 0;
  private spinner?: Ora;

  constructor(private readonly config: TunnelConfig) {}

  async connect(): Promise<void> {
    this.spinner = ora('Connecting to Beeceptor tunnel server...').start();

    this.ws = new WebSocket(this.config.serverUrl, {
      headers: this.config.apiKey
        ? { 'X-API-Key': this.config.apiKey }
        : undefined,
    });

    return new Promise((resolve, reject) => {
      this.ws!.on('open', () => {
        this.ws!.send(JSON.stringify({
          type: 'tunnel/connect',
          payload: {
            localPort: this.config.localPort,
            localHost: this.config.localHost,
            preferredSubdomain: this.config.preferredSubdomain,
          },
        }));
        resolve();
      });

      this.ws!.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; payload: any };

          if (msg.type === 'tunnel/connected') {
            this.tunnelId = msg.payload.tunnelId;
            this.publicUrl = msg.payload.publicUrl;
            this.spinner?.succeed('Tunnel connected!');
            this.displayInfo();
          }

          if (msg.type === 'tunnel/request') {
            void this.handleRequest(msg.payload as ProxiedRequest);
          }
        } catch (err) {
          this.spinner?.fail('Message parse error');
          reject(err);
        }
      });

      this.ws!.on('error', (err) => {
        this.spinner?.fail('Connection failed');
        reject(err);
      });
    });
  }

  private displayInfo(): void {
    const info = boxen(
      chalk.bold.cyan('Tunnel Active\n\n') +
      chalk.white(`Public URL:  ${chalk.green(this.publicUrl)}\n`) +
      chalk.white(
        `Forwarding:  ${chalk.yellow(`http://${this.config.localHost}:${this.config.localPort}`)}\n\n`,
      ) +
      chalk.dim('Press Ctrl+C to stop'),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan' },
    );
    console.log(info);

    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nShutting down tunnel...'));
      this.disconnect();
      process.exit(0);
    });
  }

  private async handleRequest(request: ProxiedRequest): Promise<void> {
    this.requestCount++;
    const startTime = Date.now();

    try {
      const targetUrl = `http://${this.config.localHost}:${this.config.localPort}${request.path}`;
      const fullUrl = request.queryString
        ? `${targetUrl}?${request.queryString}`
        : targetUrl;

      const headers: Record<string, string> = {};
      for (const [key, values] of Object.entries(request.headers)) {
        headers[key] = Array.isArray(values) ? values.join(', ') : values;
      }

      const body = request.body
        ? Buffer.from(request.body, 'base64')
        : undefined;

      const response = await axios({
        method: request.method,
        url: fullUrl,
        headers,
        data: body,
        validateStatus: () => true,
        responseType: 'arraybuffer',
      });

      const duration = Date.now() - startTime;

      this.ws!.send(JSON.stringify({
        type: 'tunnel/response',
        payload: {
          id: request.id,
          statusCode: response.status,
          headers: response.headers,
          body: Buffer.from(response.data as ArrayBuffer).toString('base64'),
        },
      }));

      if (this.config.enableLogging) {
        this.logRequest(request.method, request.path, response.status, duration);
      }
    } catch (error: any) {
      this.ws!.send(JSON.stringify({
        type: 'tunnel/response',
        payload: {
          id: request.id,
          statusCode: 502,
          headers: {},
          body: Buffer.from(`Bad Gateway - ${error.message}`).toString('base64'),
        },
      }));

      if (this.config.enableLogging) {
        console.log(
          chalk.red(`[${new Date().toLocaleTimeString()}]`),
          chalk.bold(request.method),
          request.path,
          chalk.red('→ ERROR'),
          chalk.dim(error.message),
        );
      }
    }
  }

  private logRequest(method: string, path: string, status: number, duration: number): void {
    const statusColor = status < 300 ? chalk.green : status < 400 ? chalk.yellow : chalk.red;
    const methodColor =
      method === 'GET' ? chalk.blue :
      method === 'POST' ? chalk.green :
      method === 'PUT' ? chalk.yellow :
      method === 'DELETE' ? chalk.red : chalk.white;

    console.log(
      chalk.dim(`[${new Date().toLocaleTimeString()}]`),
      methodColor.bold(method.padEnd(7)),
      path.padEnd(40),
      statusColor(`${status}`),
      chalk.dim(`(${duration}ms)`),
    );
  }

  private disconnect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tunnel/disconnect', payload: {} }));
      this.ws.close();
    }
  }
}
```

#### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Dashboard Integration

#### `TunnelDashboard.tsx` (Frontend — unchanged, React)

```typescript
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Terminal, ExternalLink } from 'lucide-react';

interface Tunnel {
  id: string;
  publicUrl: string;
  localHost: string;
  localPort: number;
  requestCount: number;
  createdAt: string;
}

export function TunnelDashboard() {
  const [activeTunnels, setActiveTunnels] = useState<Tunnel[]>([]);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const ws = new WebSocket('wss://tunnel.beeceptor.com/tunnel-ws');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'TUNNEL_LIST') {
        setActiveTunnels(data.tunnels);
      }
    };
    return () => ws.close();
  }, []);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Local Tunneling</h1>
        <Button onClick={() => setShowInstructions(!showInstructions)}>
          <Terminal className="mr-2 h-4 w-4" />
          Setup Instructions
        </Button>
      </div>

      {showInstructions && (
        <Card className="p-6 mb-6 bg-slate-50">
          <h2 className="text-lg font-semibold mb-3">Quick Start</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-gray-600 mb-2">1. Install the CLI tool:</p>
              <CodeBlock code="npm install -g @beeceptor/tunnel" />
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">2. Start a tunnel:</p>
              <CodeBlock code="beeceptor tunnel --port 3000" />
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">3. Your local server is now public!</p>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {activeTunnels.length === 0 ? (
          <Card className="p-8 text-center">
            <Terminal className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600">No active tunnels</p>
            <p className="text-sm text-gray-500 mt-2">Start the CLI tool to create a tunnel</p>
          </Card>
        ) : (
          activeTunnels.map((tunnel) => (
            <Card key={tunnel.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="font-mono text-sm font-medium">{tunnel.publicUrl}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-4">
                    Forwarding to:{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded">
                      {tunnel.localHost}:{tunnel.localPort}
                    </code>
                  </div>
                  <div className="flex gap-4 text-sm text-gray-500">
                    <span>Requests: {tunnel.requestCount}</span>
                    <span>Started: {new Date(tunnel.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(tunnel.publicUrl)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(tunnel.publicUrl, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-sm font-mono overflow-x-auto">
        {code}
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute top-2 right-2"
        onClick={() => navigator.clipboard.writeText(code)}
      >
        <Copy className="h-3 w-3" />
      </Button>
    </div>
  );
}
```

### Testing Checklist

- [ ] CLI installs globally via npm
- [ ] CLI connects to WebSocket server
- [ ] Public URL is generated and returned
- [ ] HTTP requests forwarded to localhost correctly
- [ ] Request/response headers preserved
- [ ] Request body (POST/PUT) forwarded properly
- [ ] Binary responses (images, files) work
- [ ] Timeout handling (30s) works
- [ ] Graceful shutdown with Ctrl+C
- [ ] Multiple tunnels can run simultaneously
- [ ] Reconnection after network interruption
- [ ] Request logging displays properly
- [ ] Dashboard shows active tunnels
- [ ] Copy URL button works
- [ ] Error messages are helpful

---

## Feature #13: Team Collaboration

### Overview
Enable teams to share endpoints, collaborate on mock configurations, and manage access control.

### Database Schema (Prisma)

```prisma
// prisma/schema.prisma (add to existing schema)

model Team {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  ownerId     String
  owner       User     @relation("TeamOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  members     TeamMember[]
  invitations TeamInvitation[]
  endpoints   Endpoint[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("teams")
}

model TeamMember {
  id       String   @id @default(uuid())
  teamId   String
  team     Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     TeamRole
  joinedAt DateTime @default(now())

  @@unique([teamId, userId])
  @@map("team_members")
}

model TeamInvitation {
  id         String    @id @default(uuid())
  teamId     String
  team       Team      @relation(fields: [teamId], references: [id], onDelete: Cascade)
  email      String
  role       TeamRole
  token      String    @unique
  invitedById String
  invitedBy  User      @relation("InvitedBy", fields: [invitedById], references: [id])
  expiresAt  DateTime
  acceptedAt DateTime?
  createdAt  DateTime  @default(now())

  @@map("team_invitations")
}

enum TeamRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

// Add to existing Endpoint model:
// teamId   String?
// team     Team?   @relation(fields: [teamId], references: [id], onDelete: SetNull)
// isShared Boolean @default(false)
```

### Backend Implementation

#### 1. Team Service

```typescript
// src/services/team.service.ts
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type { TeamRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { emailService } from './email.service.js';

const ROLE_PERMISSIONS: Record<TeamRole, { canEdit: boolean; canInvite: boolean; canManageMembers: boolean }> = {
  OWNER:  { canEdit: true,  canInvite: true,  canManageMembers: true },
  ADMIN:  { canEdit: true,  canInvite: true,  canManageMembers: true },
  MEMBER: { canEdit: true,  canInvite: false, canManageMembers: false },
  VIEWER: { canEdit: false, canInvite: false, canManageMembers: false },
};

export const teamService = {
  async createTeam(name: string, slug: string, ownerId: string) {
    const existing = await prisma.team.findUnique({ where: { slug } });
    if (existing) throw Object.assign(new Error('Team slug already exists'), { statusCode: 409 });

    return prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { name, slug, ownerId } });
      await tx.teamMember.create({
        data: { teamId: team.id, userId: ownerId, role: 'OWNER' },
      });
      return team;
    });
  },

  async inviteMember(teamId: string, email: string, role: TeamRole, invitedById: string) {
    const inviter = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: invitedById } },
    });
    if (!inviter) throw Object.assign(new Error('Not a team member'), { statusCode: 403 });
    if (!ROLE_PERMISSIONS[inviter.role].canInvite)
      throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const alreadyMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: existingUser.id } },
      });
      if (alreadyMember) throw Object.assign(new Error('User is already a team member'), { statusCode: 409 });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await prisma.teamInvitation.create({
      data: { teamId, email, role, token, invitedById, expiresAt },
      include: { team: true, invitedBy: true },
    });

    await emailService.sendTeamInvitation(email, invitation.team, invitation.invitedBy, token);

    // Cache token → teamId in Redis for fast lookup
    await redis.setex(`invite:${token}`, 7 * 24 * 3600, teamId);

    return invitation;
  },

  async acceptInvitation(token: string, userId: string) {
    const invitation = await prisma.teamInvitation.findUnique({ where: { token } });
    if (!invitation) throw Object.assign(new Error('Invalid invitation'), { statusCode: 404 });
    if (invitation.acceptedAt) throw Object.assign(new Error('Invitation already accepted'), { statusCode: 409 });
    if (invitation.expiresAt < new Date()) throw Object.assign(new Error('Invitation expired'), { statusCode: 410 });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== invitation.email.toLowerCase())
      throw Object.assign(new Error('Email mismatch'), { statusCode: 403 });

    await prisma.$transaction([
      prisma.teamMember.create({ data: { teamId: invitation.teamId, userId, role: invitation.role } }),
      prisma.teamInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    ]);

    await redis.del(`invite:${token}`);
  },

  async updateMemberRole(teamId: string, targetUserId: string, newRole: TeamRole, requesterId: string) {
    const requester = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: requesterId } },
    });
    if (!requester || !ROLE_PERMISSIONS[requester.role].canManageMembers)
      throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });

    const target = await prisma.teamMember.findUniqueOrThrow({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (target.role === 'OWNER')
      throw Object.assign(new Error('Cannot change owner role'), { statusCode: 403 });

    return prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { role: newRole },
    });
  },

  async removeMember(teamId: string, targetUserId: string, requesterId: string) {
    const requester = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: requesterId } },
    });
    if (!requester || !ROLE_PERMISSIONS[requester.role].canManageMembers)
      throw Object.assign(new Error('Insufficient permissions'), { statusCode: 403 });

    const target = await prisma.teamMember.findUniqueOrThrow({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (target.role === 'OWNER')
      throw Object.assign(new Error('Cannot remove team owner'), { statusCode: 403 });
    if (targetUserId === requesterId)
      throw Object.assign(new Error('Use leave endpoint to remove yourself'), { statusCode: 400 });

    await prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId: targetUserId } } });
  },

  async getUserTeams(userId: string) {
    return prisma.team.findMany({
      where: { members: { some: { userId } } },
      include: { members: { include: { user: true } } },
    });
  },

  async getUserRole(teamId: string, userId: string): Promise<TeamRole | null> {
    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    return member?.role ?? null;
  },
};
```

#### 2. Authorization Hook (Fastify preHandler)

```typescript
// src/hooks/team-auth.hook.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { teamService } from '../services/team.service.js';

export function requireTeamAccess(requireEdit = false) {
  return async (request: FastifyRequest<{ Params: { endpointId: string } }>, reply: FastifyReply) => {
    const { endpointId } = request.params;
    const userId = request.user!.id; // Populated by auth plugin

    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) return reply.status(404).send({ error: 'Endpoint not found' });

    if (!endpoint.teamId) {
      if (endpoint.userId !== userId) return reply.status(403).send({ error: 'Access denied' });
      return;
    }

    const role = await teamService.getUserRole(endpoint.teamId, userId);
    if (!role) return reply.status(403).send({ error: 'Not a team member' });

    const perms = { OWNER: true, ADMIN: true, MEMBER: true, VIEWER: false } as const;
    if (requireEdit && !perms[role]) return reply.status(403).send({ error: 'Insufficient permissions' });
  };
}
```

#### 3. Fastify Route Plugin

```typescript
// src/routes/teams.ts
import type { FastifyInstance } from 'fastify';
import { teamService } from '../services/team.service.js';
import type { TeamRole } from '@prisma/client';

export async function teamRoutes(fastify: FastifyInstance) {
  // POST /api/teams
  fastify.post('/', async (request, reply) => {
    const { name, slug } = request.body as { name: string; slug: string };
    const team = await teamService.createTeam(name, slug, request.user!.id);
    return reply.status(201).send(team);
  });

  // GET /api/teams
  fastify.get('/', async (request) => {
    return teamService.getUserTeams(request.user!.id);
  });

  // GET /api/teams/:teamId
  fastify.get<{ Params: { teamId: string } }>('/:teamId', async (request, reply) => {
    const role = await teamService.getUserRole(request.params.teamId, request.user!.id);
    if (!role) return reply.status(403).send({ error: 'Access denied' });

    const { prisma } = await import('../lib/prisma.js');
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: request.params.teamId },
      include: {
        members: { include: { user: true } },
        endpoints: true,
        invitations: { where: { acceptedAt: null, expiresAt: { gt: new Date() } } },
      },
    });
    return { ...team, userRole: role };
  });

  // POST /api/teams/:teamId/invite
  fastify.post<{ Params: { teamId: string } }>('/:teamId/invite', async (request, reply) => {
    const { email, role } = request.body as { email: string; role: TeamRole };
    const invitation = await teamService.inviteMember(
      request.params.teamId, email, role, request.user!.id,
    );
    return reply.status(201).send(invitation);
  });

  // POST /api/teams/invitations/:token/accept
  fastify.post<{ Params: { token: string } }>('/invitations/:token/accept', async (request) => {
    await teamService.acceptInvitation(request.params.token, request.user!.id);
    return { ok: true };
  });

  // PATCH /api/teams/:teamId/members/:userId
  fastify.patch<{ Params: { teamId: string; userId: string } }>(
    '/:teamId/members/:userId',
    async (request) => {
      const { role } = request.body as { role: TeamRole };
      await teamService.updateMemberRole(
        request.params.teamId, request.params.userId, role, request.user!.id,
      );
      return { ok: true };
    },
  );

  // DELETE /api/teams/:teamId/members/:userId
  fastify.delete<{ Params: { teamId: string; userId: string } }>(
    '/:teamId/members/:userId',
    async (request, reply) => {
      await teamService.removeMember(
        request.params.teamId, request.params.userId, request.user!.id,
      );
      return reply.status(204).send();
    },
  );
}
```

### Frontend Implementation

#### 1. Team Switcher Component (unchanged — React/TSX)

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Users, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTeamStore } from '@/stores/team';

export function TeamSwitcher() {
  const { data: teams } = useQuery(['teams'], fetchUserTeams);
  const [selectedTeam, setSelectedTeam] = useTeamStore((s) => [s.selectedTeam, s.setSelectedTeam]);

  return (
    <Select
      value={selectedTeam?.id}
      onValueChange={(id) => {
        const team = teams?.find((t) => t.id === id);
        setSelectedTeam(team);
      }}
    >
      <SelectTrigger className="w-[200px]">
        <Users className="mr-2 h-4 w-4" />
        {selectedTeam?.name || 'Personal'}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="personal">Personal</SelectItem>
        {teams?.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
        <SelectItem value="create-new" className="text-blue-600">
          <Plus className="mr-2 h-4 w-4" />
          Create Team
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
```

#### 2. Team Management Page (unchanged — React/TSX)

```typescript
export function TeamSettingsPage() {
  const { teamId } = useParams();
  const { data: team } = useQuery(['team', teamId], () => fetchTeam(teamId));
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('member');

  const inviteMutation = useMutation(
    (data: { email: string; role: TeamRole }) =>
      api.post(`/api/teams/${teamId}/invite`, data),
    { onSuccess: () => { toast.success('Invitation sent!'); setInviteEmail(''); } },
  );

  return (
    <div className="p-6 space-y-6">
      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4">Team Members</h2>
        <div className="flex gap-2 mb-6">
          <Input
            placeholder="Email address"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <Select value={inviteRole} onValueChange={setInviteRole}>
            <SelectTrigger className="w-[150px]">{inviteRole}</SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}>
            Send Invite
          </Button>
        </div>
        <div className="space-y-2">
          {team?.members.map((member) => (
            <div key={member.id} className="flex items-center justify-between p-3 border rounded">
              <div>
                <p className="font-medium">{member.user.name}</p>
                <p className="text-sm text-gray-600">{member.user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                  {member.role}
                </Badge>
                {team.userRole !== 'viewer' && member.role !== 'owner' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => changeRole(member.id, 'admin')}>
                        Change to Admin
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => changeRole(member.id, 'member')}>
                        Change to Member
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => changeRole(member.id, 'viewer')}>
                        Change to Viewer
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() => removeMember(member.id)}
                      >
                        Remove from team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4">Pending Invitations</h2>
        {team?.pendingInvitations.length === 0 ? (
          <p className="text-gray-600">No pending invitations</p>
        ) : (
          <div className="space-y-2">
            {team?.pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-3 border rounded">
                <div>
                  <p className="font-medium">{inv.email}</p>
                  <p className="text-sm text-gray-600">
                    Invited by {inv.invitedBy.name} • Expires {formatDate(inv.expiresAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => cancelInvitation(inv.id)}>
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
```

#### 3. Endpoint Sharing UI (unchanged — React/TSX)

```typescript
export function EndpointShareDialog({ endpointId }: { endpointId: string }) {
  const { data: teams } = useQuery(['teams'], fetchUserTeams);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  const shareMutation = useMutation(
    (teamId: string) => api.patch(`/api/endpoints/${endpointId}`, { teamId, isShared: true }),
    { onSuccess: () => toast.success('Endpoint shared with team!') },
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="mr-2 h-4 w-4" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Endpoint</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this endpoint with a team to allow collaboration
          </p>
          <Select value={selectedTeam ?? ''} onValueChange={setSelectedTeam}>
            <SelectTrigger>
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {teams?.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="w-full"
            disabled={!selectedTeam}
            onClick={() => selectedTeam && shareMutation.mutate(selectedTeam)}
          >
            Share Endpoint
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Testing Checklist

- [ ] Can create team with name and slug
- [ ] Owner automatically added as admin
- [ ] Can invite members by email
- [ ] Invitation emails sent correctly
- [ ] Can accept invitation via token
- [ ] Expired invitations rejected
- [ ] Can change member roles (admin only)
- [ ] Cannot demote owner
- [ ] Can remove members (admin only)
- [ ] Members see team endpoints in list
- [ ] Viewers can view but not edit
- [ ] Members can edit endpoints
- [ ] Admins can manage team settings
- [ ] Team switcher works in UI
- [ ] Endpoint sharing dialog works
- [ ] Activity log shows team changes
- [ ] Permissions enforced on API

---

## Feature #14: White-Labeling & Custom Domains

### Overview
Allow users to use custom domains (e.g., `api.company.com`) instead of Beeceptor subdomains for their mock endpoints.

### Database Schema (Prisma)

```prisma
model CustomDomain {
  id                String    @id @default(uuid())
  domain            String    @unique
  endpointId        String
  endpoint          Endpoint  @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  userId            String
  user              User      @relation(fields: [userId], references: [id])
  verificationToken String
  verifiedAt        DateTime?
  sslCertificate    String?
  sslPrivateKey     String?
  sslExpiresAt      DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([domain])
  @@index([endpointId])
  @@map("custom_domains")
}
```

### Backend Implementation

#### 1. Domain Service

```typescript
// src/services/custom-domain.service.ts
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acme } from '../lib/acme.js'; // Wraps node-acme-client

const execFileAsync = promisify(execFile);

const DOMAIN_REGEX = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}$/;

export const customDomainService = {
  isValidDomain(domain: string): boolean {
    return DOMAIN_REGEX.test(domain);
  },

  async createCustomDomain(endpointId: string, domain: string, userId: string) {
    if (!this.isValidDomain(domain))
      throw Object.assign(new Error('Invalid domain format'), { statusCode: 400 });

    const existing = await prisma.customDomain.findUnique({ where: { domain } });
    if (existing) throw Object.assign(new Error('Domain already registered'), { statusCode: 409 });

    const verificationToken = randomUUID();
    const record = await prisma.customDomain.create({
      data: { domain, endpointId, userId, verificationToken },
    });

    // Cache domain → endpointId for fast routing lookups
    await redis.setex(`domain:${domain}`, 3600, endpointId);

    return record;
  },

  getVerificationInstructions(domain: string, verificationToken: string) {
    return {
      domain,
      verificationToken,
      method1_cname: { type: 'CNAME', name: domain, value: 'proxy.beeceptor.com' },
      method2_txt: { type: 'TXT', name: `_beeceptor-verify.${domain}`, value: verificationToken },
    };
  },

  async verifyCname(domain: string): Promise<boolean> {
    try {
      const addresses = await dns.resolveCname(domain);
      return addresses.some(
        (a) => a === 'proxy.beeceptor.com' || a === 'proxy.beeceptor.com.',
      );
    } catch {
      return false;
    }
  },

  async verifyTxt(domain: string, token: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(`_beeceptor-verify.${domain}`);
      return records.flat().some((r) => r.includes(token));
    } catch {
      return false;
    }
  },

  async verifyDomain(domainId: string) {
    const record = await prisma.customDomain.findUniqueOrThrow({ where: { id: domainId } });
    if (record.verifiedAt) return record; // Already verified

    const [cnameValid, txtValid] = await Promise.all([
      this.verifyCname(record.domain),
      this.verifyTxt(record.domain, record.verificationToken),
    ]);

    if (!cnameValid && !txtValid)
      throw Object.assign(
        new Error('Domain not verified. DNS records not found.'),
        { statusCode: 412 },
      );

    const updated = await prisma.customDomain.update({
      where: { id: domainId },
      data: { verifiedAt: new Date() },
    });

    // Provision SSL asynchronously — don't block the response
    void this.provisionSslCertificate(updated).catch((err) =>
      console.error(`SSL provisioning failed for ${record.domain}`, err),
    );

    return updated;
  },

  async provisionSslCertificate(record: { id: string; domain: string; endpointId: string }) {
    const cert = await acme.obtainCertificate(record.domain);

    const certPath = `/etc/ssl/certs/${record.domain}.crt`;
    const keyPath = `/etc/ssl/private/${record.domain}.key`;

    await Promise.all([
      fs.writeFile(certPath, cert.certificate),
      fs.writeFile(keyPath, cert.privateKey, { mode: 0o600 }),
    ]);

    await prisma.customDomain.update({
      where: { id: record.id },
      data: {
        sslCertificate: cert.certificate,
        sslPrivateKey: cert.privateKey,
        sslExpiresAt: cert.expiresAt,
      },
    });

    await this.configureProxy(record.domain, record.endpointId);
  },

  async configureProxy(domain: string, endpointId: string) {
    const config = `
server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/ssl/certs/${domain}.crt;
    ssl_certificate_key /etc/ssl/private/${domain}.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://localhost:3000/api/endpoints/${endpointId}/mock;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}
`.trim();

    const availablePath = path.join('/etc/nginx/sites-available', domain);
    const enabledPath = path.join('/etc/nginx/sites-enabled', domain);

    await fs.writeFile(availablePath, config);
    await fs.symlink(availablePath, enabledPath).catch(() => {}); // Ignore if already linked
    await execFileAsync('nginx', ['-s', 'reload']);
  },

  async renewSslCertificate(domainId: string) {
    const record = await prisma.customDomain.findUniqueOrThrow({ where: { id: domainId } });
    const renewalThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    if (record.sslExpiresAt && record.sslExpiresAt > renewalThreshold) return; // Not yet due

    await this.provisionSslCertificate(record);
  },

  async deleteDomain(domainId: string, userId: string) {
    const record = await prisma.customDomain.findUniqueOrThrow({ where: { id: domainId } });
    if (record.userId !== userId)
      throw Object.assign(new Error('Access denied'), { statusCode: 403 });

    await prisma.customDomain.delete({ where: { id: domainId } });
    await redis.del(`domain:${record.domain}`);

    // Clean up nginx config
    const availablePath = path.join('/etc/nginx/sites-available', record.domain);
    const enabledPath = path.join('/etc/nginx/sites-enabled', record.domain);
    await Promise.all([
      fs.unlink(availablePath).catch(() => {}),
      fs.unlink(enabledPath).catch(() => {}),
    ]);
    await execFileAsync('nginx', ['-s', 'reload']).catch(() => {});
  },

  async getEndpointDomains(endpointId: string) {
    return prisma.customDomain.findMany({ where: { endpointId } });
  },
};
```

#### 2. Background Job — SSL Renewal (using a simple Node.js cron)

```typescript
// src/jobs/ssl-renewal.job.ts
import { prisma } from '../lib/prisma.js';
import { customDomainService } from '../services/custom-domain.service.js';

// Register in your app startup: run daily at 02:00
export async function renewExpiringSslCertificates() {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const expiring = await prisma.customDomain.findMany({
    where: {
      verifiedAt: { not: null },
      sslExpiresAt: { lte: thirtyDaysFromNow },
    },
  });

  for (const domain of expiring) {
    try {
      await customDomainService.renewSslCertificate(domain.id);
      console.info(`Renewed SSL for domain: ${domain.domain}`);
    } catch (err) {
      console.error(`Failed to renew SSL for ${domain.domain}`, err);
      // TODO: Send alert email to domain.userId
    }
  }
}
```

#### 3. Fastify Route Plugin

```typescript
// src/routes/custom-domains.ts
import type { FastifyInstance } from 'fastify';
import { customDomainService } from '../services/custom-domain.service.js';

export async function customDomainRoutes(fastify: FastifyInstance) {
  // POST /api/custom-domains
  fastify.post('/', async (request, reply) => {
    const { endpointId, domain } = request.body as { endpointId: string; domain: string };
    const record = await customDomainService.createCustomDomain(
      endpointId, domain, request.user!.id,
    );
    return reply.status(201).send(record);
  });

  // GET /api/custom-domains/:domainId/verification
  fastify.get<{ Params: { domainId: string } }>('/:domainId/verification', async (request) => {
    const record = await (await import('../lib/prisma.js')).prisma.customDomain.findUniqueOrThrow({
      where: { id: request.params.domainId },
    });
    return customDomainService.getVerificationInstructions(record.domain, record.verificationToken);
  });

  // POST /api/custom-domains/:domainId/verify
  fastify.post<{ Params: { domainId: string } }>('/:domainId/verify', async (request) => {
    return customDomainService.verifyDomain(request.params.domainId);
  });

  // DELETE /api/custom-domains/:domainId
  fastify.delete<{ Params: { domainId: string } }>('/:domainId', async (request, reply) => {
    await customDomainService.deleteDomain(request.params.domainId, request.user!.id);
    return reply.status(204).send();
  });

  // GET /api/custom-domains/endpoint/:endpointId
  fastify.get<{ Params: { endpointId: string } }>('/endpoint/:endpointId', async (request) => {
    return customDomainService.getEndpointDomains(request.params.endpointId);
  });
}
```

### Frontend Implementation (unchanged — React/TSX)

```typescript
export function CustomDomainPanel({ endpointId }: { endpointId: string }) {
  const { data: domains } = useQuery(['domains', endpointId], () =>
    api.get(`/api/custom-domains/endpoint/${endpointId}`),
  );
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  const createMutation = useMutation(
    (domain: string) => api.post('/api/custom-domains', { endpointId, domain }),
    {
      onSuccess: () => {
        toast.success('Domain added! Please verify DNS settings.');
        setShowAdd(false);
        setNewDomain('');
      },
    },
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Custom Domains</h3>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Domain
        </Button>
      </div>

      {domains?.map((domain) => (
        <Card key={domain.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-gray-400" />
              <div>
                <p className="font-mono font-medium">{domain.domain}</p>
                {domain.verifiedAt ? (
                  <div className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    Verified & Active
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-sm text-yellow-600">
                    <AlertCircle className="h-4 w-4" />
                    Pending Verification
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {!domain.verifiedAt && (
                <Button variant="outline" size="sm" onClick={() => openVerification(domain)}>
                  Verify
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => deleteDomain(domain.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Domain</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Domain Name</Label>
              <Input
                placeholder="api.mycompany.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
              <p className="text-sm text-gray-600 mt-2">
                You'll need to configure DNS settings after adding the domain.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => createMutation.mutate(newDomain)}
              disabled={!newDomain}
            >
              Add Domain
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DomainVerificationDialog({ domain }: { domain: CustomDomain }) {
  const { data: instructions } = useQuery(
    ['verification', domain.id],
    () => api.get(`/api/custom-domains/${domain.id}/verification`),
  );

  const verifyMutation = useMutation(
    () => api.post(`/api/custom-domains/${domain.id}/verify`),
    {
      onSuccess: () => toast.success('Domain verified!'),
      onError: () => toast.error('Verification failed. Please check DNS records.'),
    },
  );

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Verify {domain.domain}</DialogTitle>
      </DialogHeader>
      <div className="space-y-6">
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            Add one of the following DNS records to verify domain ownership:
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Method 1: CNAME Record (Recommended)</h4>
            <div className="bg-gray-50 p-4 rounded border space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Type:</span>
                <code className="text-sm">CNAME</code>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Name:</span>
                <code className="text-sm">{domain.domain}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Value:</span>
                <code className="text-sm">proxy.beeceptor.com</code>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-2">Method 2: TXT Record</h4>
            <div className="bg-gray-50 p-4 rounded border space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Type:</span>
                <code className="text-sm">TXT</code>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Name:</span>
                <code className="text-sm">_beeceptor-verify.{domain.domain}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Value:</span>
                <code className="text-sm">{instructions?.verificationToken}</code>
              </div>
            </div>
          </div>
        </div>

        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription>
            DNS changes can take up to 48 hours to propagate, though usually it's much faster (5–30 minutes).
          </AlertDescription>
        </Alert>

        <Button
          className="w-full"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isLoading}
        >
          {verifyMutation.isLoading ? 'Verifying...' : 'Verify Domain'}
        </Button>
      </div>
    </DialogContent>
  );
}
```

### Testing Checklist

- [ ] Can add custom domain
- [ ] Verification instructions displayed correctly
- [ ] CNAME verification works
- [ ] TXT verification works
- [ ] SSL certificate provisioned automatically
- [ ] HTTPS works on custom domain
- [ ] HTTP redirects to HTTPS
- [ ] Mock endpoint accessible via custom domain
- [ ] Multiple domains per endpoint supported
- [ ] SSL auto-renewal works (30 days before expiry)
- [ ] Domain deletion removes nginx config
- [ ] Error messages are helpful
- [ ] DNS propagation delays handled gracefully
