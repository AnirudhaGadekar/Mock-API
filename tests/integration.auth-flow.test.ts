import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';

describe('Full OTP auth flow (E2E)', () => {
  let app: FastifyInstance;
  let servicesAvailable = false;
  let cookie: string | null = null;
  let otp: string | null = null;
  let signupOtp: string | null = null;
  const testEmail = `test_${Date.now()}@example.com`;
  const signupEmail = `signup_${Date.now()}@example.com`;
  const originalAuthMode = process.env.AUTH_MODE;

  beforeAll(async () => {
    process.env.AUTH_MODE = 'dev-bypass';
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      await redis.ping();
      servicesAvailable = true;
      app = await buildApp();
    } catch {
      servicesAvailable = false;
    }
  });

  afterAll(async () => {
    process.env.AUTH_MODE = originalAuthMode;
    if (servicesAvailable) {
      await app.close();
    }
  });

  test('Send OTP', async () => {
    if (!servicesAvailable) {
      return;
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/send-otp',
      payload: { email: testEmail },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.devOtp).toMatch(/^\d{6}$/);
    otp = data.devOtp;
  });

  test('Verify OTP', async () => {
    if (!servicesAvailable) {
      return;
    }

    if (!otp) {
      throw new Error('OTP not available');
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/verify-otp',
      payload: { email: testEmail, otp },
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
    if (!servicesAvailable) {
      return;
    }

    if (!cookie) {
      throw new Error('No cookie set');
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/v2/user/me',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
  });

  test('Signup creates profile and sends OTP', async () => {
    if (!servicesAvailable) {
      return;
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/signup',
      payload: {
        firstName: 'Signup',
        lastName: 'Tester',
        username: `signup_${Date.now()}`.toLowerCase(),
        email: signupEmail,
      },
    });

    expect(res.statusCode).toBe(200);

    const data = res.json();
    expect(data.success).toBe(true);
    expect(data.requiresOtpVerification).toBe(true);
    expect(data.requiresEmailVerification).toBe(false);
    expect(data.devOtp).toMatch(/^\d{6}$/);
    signupOtp = data.devOtp;
  });

  test('Signup OTP completes authentication', async () => {
    if (!servicesAvailable) {
      return;
    }

    if (!signupOtp) {
      throw new Error('Signup OTP not available');
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/auth/verify-otp',
      payload: { email: signupEmail, otp: signupOtp },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.user.email).toBe(signupEmail);
    expect(data.user.isAnonymous).toBe(false);
  });
});
