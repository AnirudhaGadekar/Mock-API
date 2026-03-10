import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';

function parseBody(res: { payload: string }) {
  try {
    return JSON.parse(res.payload);
  } catch {
    return null;
  }
}

describe('API v2 Contract', () => {
  let app: FastifyInstance;
  let bootstrapApiKey = '';

  beforeAll(async () => {
    app = await buildApp();

    const anonRes = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/anonymous',
    });

    expect(anonRes.statusCode).toBe(200);
    const anonBody = parseBody(anonRes);
    bootstrapApiKey = anonBody?.apiKey;
    expect(typeof bootstrapApiKey).toBe('string');
    expect(bootstrapApiKey.length).toBeGreaterThan(10);
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a scoped service key and uses it for read/write endpoint operations', async () => {
    const suffix = Date.now().toString().slice(-6);
    const baseName = `v2demo-${suffix}`;
    const updatedName = `v2upd-${suffix}`;

    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-endpoint-manager',
        scopes: ['endpoints:read', 'endpoints:write'],
        workspaceType: 'PERSONAL',
      },
    });

    expect(createKeyRes.statusCode).toBe(201);
    const createKeyBody = parseBody(createKeyRes);
    expect(createKeyBody?.timestamp).toBeTruthy();
    const scopedKey = createKeyBody?.data?.key as string;
    expect(scopedKey).toMatch(/^murl_sk_/);

    const createEndpointRes = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': scopedKey },
      payload: { name: baseName },
    });

    expect(createEndpointRes.statusCode).toBe(201);
    const endpointBody = parseBody(createEndpointRes);
    expect(endpointBody?.success).toBe(true);
    expect(endpointBody?.timestamp).toBeTruthy();
    expect(endpointBody?.data?.subdomain).toBe(baseName);

    const endpointId = endpointBody?.data?.id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v2/endpoints/${endpointId}`,
      headers: { 'x-api-key': scopedKey },
      payload: { name: updatedName },
    });

    expect(patchRes.statusCode).toBe(200);
    const patchBody = parseBody(patchRes);
    expect(patchBody?.data?.subdomain).toBe(updatedName);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints?limit=10',
      headers: { 'x-api-key': scopedKey },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = parseBody(listRes);
    expect(Array.isArray(listBody?.data?.endpoints)).toBe(true);
    expect(listBody?.data?.endpoints.some((ep: any) => ep.id === endpointId)).toBe(true);
  });

  it('rejects writes when key only has endpoints:read scope', async () => {
    const suffix = Date.now().toString().slice(-6);
    const createReadOnlyKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-read-only',
        scopes: ['endpoints:read'],
        workspaceType: 'PERSONAL',
      },
    });

    expect(createReadOnlyKeyRes.statusCode).toBe(201);
    const readOnlyKey = parseBody(createReadOnlyKeyRes)?.data?.key as string;

    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': readOnlyKey },
      payload: { name: `v2ro-${suffix}` },
    });

    expect(writeRes.statusCode).toBe(403);
    const writeBody = parseBody(writeRes);
    expect(writeBody?.error?.code).toBe('INSUFFICIENT_SCOPE');
    expect(writeBody?.timestamp).toBeTruthy();
    expect(writeBody?.requestId).toBeTruthy();

    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': readOnlyKey },
    });

    expect(readRes.statusCode).toBe(200);
  });

  it('revokes service keys and blocks further access', async () => {
    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-revoke-check',
        scopes: ['endpoints:read'],
        workspaceType: 'PERSONAL',
      },
    });

    expect(createKeyRes.statusCode).toBe(201);
    const createKeyBody = parseBody(createKeyRes);
    const revocableKey = createKeyBody?.data?.key as string;
    const keyId = createKeyBody?.data?.metadata?.id as string;

    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v2/service-keys/${keyId}/revoke`,
      headers: { 'x-api-key': bootstrapApiKey },
    });

    expect(revokeRes.statusCode).toBe(200);

    const readAfterRevokeRes = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': revocableKey },
    });

    expect(readAfterRevokeRes.statusCode).toBe(403);
    const body = parseBody(readAfterRevokeRes);
    expect(body?.error?.code).toBe('FORBIDDEN');
    expect(body?.timestamp).toBeTruthy();
    expect(body?.requestId).toBeTruthy();
  });

  it('rotates service keys and invalidates the old key', async () => {
    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-rotate-check',
        scopes: ['endpoints:read'],
        workspaceType: 'PERSONAL',
      },
    });

    expect(createKeyRes.statusCode).toBe(201);
    const initialBody = parseBody(createKeyRes);
    const oldKey = initialBody?.data?.key as string;
    const keyId = initialBody?.data?.metadata?.id as string;

    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/v2/service-keys/${keyId}/rotate`,
      headers: { 'x-api-key': bootstrapApiKey },
    });

    expect(rotateRes.statusCode).toBe(200);
    const rotateBody = parseBody(rotateRes);
    const newKey = rotateBody?.data?.key as string;
    expect(newKey).toMatch(/^murl_sk_/);
    expect(newKey).not.toBe(oldKey);

    const oldKeyReadRes = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': oldKey },
    });
    expect(oldKeyReadRes.statusCode).toBe(403);

    const newKeyReadRes = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': newKey },
    });
    expect(newKeyReadRes.statusCode).toBe(200);
  });

  it('supports dedicated rules resource via /api/v2/endpoints/:id/rules', async () => {
    const suffix = Date.now().toString().slice(-6);
    const endpointName = `v2rules-${suffix}`;

    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-rules-manager',
        scopes: ['endpoints:read', 'endpoints:write'],
        workspaceType: 'PERSONAL',
      },
    });
    const key = parseBody(createKeyRes)?.data?.key as string;

    const createEndpointRes = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': key },
      payload: { name: endpointName },
    });
    expect(createEndpointRes.statusCode).toBe(201);
    const endpointId = parseBody(createEndpointRes)?.data?.id as string;

    const getRulesRes = await app.inject({
      method: 'GET',
      url: `/api/v2/endpoints/${endpointId}/rules`,
      headers: { 'x-api-key': key },
    });
    expect(getRulesRes.statusCode).toBe(200);
    expect(Array.isArray(parseBody(getRulesRes)?.data?.rules)).toBe(true);

    const nextRules = [
      {
        path: '/health',
        method: 'GET',
        response: { status: 200, body: { ok: true } },
      },
    ];

    const putRulesRes = await app.inject({
      method: 'PUT',
      url: `/api/v2/endpoints/${endpointId}/rules`,
      headers: { 'x-api-key': key },
      payload: { rules: nextRules },
    });
    expect(putRulesRes.statusCode).toBe(200);
    expect(parseBody(putRulesRes)?.data?.rules?.[0]?.path).toBe('/health');
  });

  it('supports security-policy resource with security scopes and blocks unauthorized scopes', async () => {
    const suffix = Date.now().toString().slice(-6);
    const endpointName = `v2sec-${suffix}`;

    const createReadWriteEndpointKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-endpoint-only',
        scopes: ['endpoints:read', 'endpoints:write'],
        workspaceType: 'PERSONAL',
      },
    });
    const endpointOnlyKey = parseBody(createReadWriteEndpointKeyRes)?.data?.key as string;

    const createEndpointRes = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': endpointOnlyKey },
      payload: { name: endpointName },
    });
    expect(createEndpointRes.statusCode).toBe(201);
    const endpointId = parseBody(createEndpointRes)?.data?.id as string;

    const forbiddenSecurityRead = await app.inject({
      method: 'GET',
      url: `/api/v2/endpoints/${endpointId}/security-policy`,
      headers: { 'x-api-key': endpointOnlyKey },
    });
    expect(forbiddenSecurityRead.statusCode).toBe(403);
    expect(parseBody(forbiddenSecurityRead)?.error?.code).toBe('INSUFFICIENT_SCOPE');

    const createSecurityKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-security-manager',
        scopes: ['security:read', 'security:write'],
        workspaceType: 'PERSONAL',
      },
    });
    const securityKey = parseBody(createSecurityKeyRes)?.data?.key as string;

    const putPolicyRes = await app.inject({
      method: 'PUT',
      url: `/api/v2/endpoints/${endpointId}/security-policy`,
      headers: { 'x-api-key': securityKey },
      payload: {
        ipAllowlist: ['10.0.0.0/8', '192.168.1.0/24'],
        maskedHeaders: ['authorization', 'x-api-key'],
        mtlsMode: 'optional',
      },
    });
    expect(putPolicyRes.statusCode).toBe(200);
    expect(parseBody(putPolicyRes)?.data?.securityPolicy?.mtlsMode).toBe('optional');

    const getPolicyRes = await app.inject({
      method: 'GET',
      url: `/api/v2/endpoints/${endpointId}/security-policy`,
      headers: { 'x-api-key': securityKey },
    });
    expect(getPolicyRes.statusCode).toBe(200);
    expect(parseBody(getPolicyRes)?.data?.securityPolicy?.maskedHeaders?.includes('authorization')).toBe(true);
  });

  it('supports idempotency for create endpoint operations', async () => {
    const suffix = Date.now().toString().slice(-6);
    const endpointName = `v2idem-${suffix}`;

    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'v2-idem-manager',
        scopes: ['endpoints:write', 'endpoints:read'],
        workspaceType: 'PERSONAL',
      },
    });
    const key = parseBody(createKeyRes)?.data?.key as string;

    const idemKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': key, 'idempotency-key': idemKey },
      payload: { name: endpointName },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = parseBody(first);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': key, 'idempotency-key': idemKey },
      payload: { name: endpointName },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = parseBody(second);
    expect(second.headers['x-idempotent-replay']).toBe('true');
    expect(secondBody?.data?.id).toBe(firstBody?.data?.id);
  });

  it('enforces strict service-key mode when enabled', async () => {
    process.env.FEATURE_V2_STRICT_SERVICE_KEYS = 'true';
    const suffix = Date.now().toString().slice(-6);

    const userKeyDenied = await app.inject({
      method: 'GET',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': bootstrapApiKey },
    });
    expect(userKeyDenied.statusCode).toBe(403);
    expect(parseBody(userKeyDenied)?.error?.code).toBe('FORBIDDEN');

    const createServiceKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v2/service-keys',
      headers: { 'x-api-key': bootstrapApiKey },
      payload: {
        name: 'strict-service-key',
        scopes: ['endpoints:read', 'endpoints:write'],
        workspaceType: 'PERSONAL',
      },
    });
    expect(createServiceKeyRes.statusCode).toBe(201);
    const serviceKey = parseBody(createServiceKeyRes)?.data?.key as string;

    const createEndpointRes = await app.inject({
      method: 'POST',
      url: '/api/v2/endpoints',
      headers: { 'x-api-key': serviceKey },
      payload: { name: `v2strict-${suffix}` },
    });
    expect(createEndpointRes.statusCode).toBe(201);

    delete process.env.FEATURE_V2_STRICT_SERVICE_KEYS;
  });
});
