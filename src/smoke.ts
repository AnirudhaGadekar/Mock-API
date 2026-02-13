import { request } from 'node:http';

type JsonValue = unknown;

function httpJson<T = JsonValue>(
  method: string,
  url: URL,
  opts?: { headers?: Record<string, string>; body?: unknown }
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; json: T; raw: string }> {
  const bodyString = opts?.body !== undefined ? JSON.stringify(opts.body) : undefined;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts?.headers ?? {}),
  };

  if (bodyString !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyString).toString();
  }

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const statusCode = res.statusCode ?? 0;

          if (!raw) {
            return resolve({ statusCode, headers: res.headers as any, json: undefined as T, raw });
          }

          try {
            const json = JSON.parse(raw) as T;
            resolve({ statusCode, headers: res.headers as any, json, raw });
          } catch (err) {
            reject(new Error(`Non-JSON response (status ${statusCode}): ${raw}`));
          }
        });
      }
    );

    req.on('error', (err) => reject(err));

    if (bodyString !== undefined) {
      req.write(bodyString);
    }
    req.end();
  });
}

function assertOk(name: string, statusCode: number, expected: number | number[]) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(statusCode)) {
    throw new Error(`${name} failed: expected status ${allowed.join(' or ')}, got ${statusCode}`);
  }
}

function failWithBody(name: string, statusCode: number, raw: string) {
  const preview = raw && raw.length > 0 ? raw : '<empty body>';
  throw new Error(`${name} failed with status ${statusCode}. Body: ${preview}`);
}

async function main() {
  const base = new URL(process.env.API_BASE ?? 'http://localhost:3000');

  const healthz = await httpJson('GET', new URL('/healthz', base));
  assertOk('healthz', healthz.statusCode, 200);

  const sessionRes = await httpJson<{ success: boolean; session: { apiKey: string; userId: string } }>(
    'POST',
    new URL('/api/v1/session', base),
    { body: {} }
  );
  assertOk('create session', sessionRes.statusCode, [200, 201]);

  const apiKey = sessionRes.json?.session?.apiKey;
  if (!apiKey) {
    throw new Error(`create session did not return session.apiKey. Raw: ${sessionRes.raw}`);
  }

  const endpointName = `smoke-${Date.now()}`;

  const createEndpointRes = await httpJson<{
    success: boolean;
    endpoint: { id: string; name: string; subdomain?: string; url?: string; rules?: unknown[] };
  }>('POST', new URL('/api/v1/endpoints/create', base), {
    headers: {
      'x-api-key': apiKey,
    },
    body: {
      name: endpointName,
    },
  });

  if (createEndpointRes.statusCode !== 201) {
    failWithBody('create endpoint', createEndpointRes.statusCode, createEndpointRes.raw);
  }

  const endpointUrl = createEndpointRes.json?.endpoint?.url;

  const out = {
    ok: true,
    base: base.toString(),
    healthz: healthz.json,
    session: sessionRes.json,
    endpoint: createEndpointRes.json,
    nextSteps: {
      mockHitNote:
        endpointUrl
          ? `To test mock routing, hit the generated subdomain URL in a browser or via curl, e.g. ${endpointUrl}/anything (requires DNS/host setup if BASE_MOCK_DOMAIN is not pointing to localhost).`
          : 'Endpoint created but did not include endpoint.url in response.',
    },
  };

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`SMOKE FAILED: ${(err as Error)?.message ?? String(err)}\n`);
  process.exitCode = 1;
});
