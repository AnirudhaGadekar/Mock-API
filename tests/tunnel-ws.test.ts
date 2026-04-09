import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchUserByApiKeyMock = vi.fn();
const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../src/middleware/auth.middleware.js', () => ({
  fetchUserByApiKey: fetchUserByApiKeyMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: loggerMock,
}));

const { activeTunnels } = await import('../src/lib/active-tunnels.js');
const { default: tunnelWsRoute } = await import('../src/routes/tunnel-ws.js');

function waitForJsonMessage(ws: websocket.WebSocket, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for websocket message'));
    }, timeoutMs);

    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });

    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function buildWsApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(tunnelWsRoute);
  await app.ready();
  return app;
}

describe('tunnel websocket route', () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    activeTunnels.clear();
    delete process.env.TUNNEL_AUTH_TIMEOUT_MS;
  });

  afterEach(async () => {
    activeTunnels.clear();
    delete process.env.TUNNEL_AUTH_TIMEOUT_MS;
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('responds with CONNECTED when CONNECT authentication succeeds', async () => {
    fetchUserByApiKeyMock.mockResolvedValue({ id: 'user-1' });
    app = await buildWsApp();

    const ws = await app.injectWS('/tunnel-ws', {
      headers: {
        'x-forwarded-host': 'api.mockapi.online',
        'x-forwarded-proto': 'https',
      },
    });

    const messagePromise = waitForJsonMessage(ws);
    ws.send(JSON.stringify({ type: 'CONNECT', apiKey: 'key_live_valid' }));

    await expect(messagePromise).resolves.toMatchObject({
      type: 'CONNECTED',
      tunnelId: expect.any(String),
      publicUrl: expect.stringContaining('https://api.mockapi.online/tunnel/'),
    });

    ws.terminate();
  });

  it('responds with ERROR when CONNECT authentication times out', async () => {
    process.env.TUNNEL_AUTH_TIMEOUT_MS = '25';
    fetchUserByApiKeyMock.mockImplementation(() => new Promise(() => {}));
    app = await buildWsApp();

    const ws = await app.injectWS('/tunnel-ws');
    const messagePromise = waitForJsonMessage(ws, 1000);
    ws.send(JSON.stringify({ type: 'CONNECT', apiKey: 'key_live_slow' }));

    await expect(messagePromise).resolves.toMatchObject({
      type: 'ERROR',
      message: expect.stringContaining('timed out'),
    });

    ws.terminate();
  });
});
