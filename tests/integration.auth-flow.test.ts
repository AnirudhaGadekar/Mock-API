import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';

describe('🔐 Full OTP Auth Flow (E2E)', () => {

  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  let cookie: string | null = null;
  let otp: string | null = null;
  const testEmail = `test_${Date.now()}@example.com`;

  test('Send OTP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/send-otp',
      payload: { email: testEmail }
    });

    const data = JSON.parse(res.payload);

    // In production mode, we expect 200 but no devOtp field
    expect(res.statusCode).toBe(200);

    // Only check for devOtp in development mode
    if (process.env.NODE_ENV === 'development' && data.devOtp) {
      otp = data.devOtp;
    } else if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'production') {
      // Local tests simulate production behavior but we bypass real emails for integration test speeds
      // We can assume the default bypass OTP or standard setup config logic 
      otp = data.devOtp || '123456';
    }
  });

  test('Verify OTP', async () => {
    if (!otp) {
      throw new Error('OTP not available');
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/verify-otp',
      payload: { email: testEmail, otp }
    });

    expect(res.statusCode).toBe(200);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();

    if (Array.isArray(setCookie)) {
      cookie = setCookie[0];
    } else if (typeof setCookie === 'string') {
      cookie = setCookie;
    }
  });

  test('Access protected route', async () => {
    if (!cookie) throw new Error('No cookie set');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/user/me',
      headers: { cookie }
    });

    expect(res.statusCode).toBe(200);
  });

});
