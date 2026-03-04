import crypto from 'crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { sendOtp, verifyOtp } from '../src/auth/otp.js';
import { prisma } from '../src/lib/db.js';

describe('OTP Data Integrity / Rollback Semantics', () => {
  afterEach(async () => {
    await prisma.otp.deleteMany({ where: { email: { contains: '@rollback.mock' } } });
  });

  test('invalid OTP increments attempts instead of deleting record', async () => {
    const email = `invalid-${crypto.randomBytes(3).toString('hex')}@rollback.mock`;

    const send = await sendOtp({ email });
    expect(send.success).toBe(true);

    const before = await prisma.otp.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
    expect(before).toBeTruthy();
    expect(before?.attempts).toBe(0);

    const result = await verifyOtp({ email, otp: '000000' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid OTP.');

    const after = await prisma.otp.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
    expect(after).toBeTruthy();
    expect(after?.attempts).toBe(1);
  });

  test('expired OTP is deleted on verify attempt', async () => {
    const email = `expired-${crypto.randomBytes(3).toString('hex')}@rollback.mock`;

    await prisma.otp.create({
      data: {
        email,
        hash: 'expired-hash',
        attempts: 0,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const result = await verifyOtp({ email, otp: '123456' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');

    const record = await prisma.otp.findFirst({ where: { email } });
    expect(record).toBeNull();
  });

  test('OTP at max attempts is deleted and locked out', async () => {
    const email = `max-${crypto.randomBytes(3).toString('hex')}@rollback.mock`;

    await prisma.otp.create({
      data: {
        email,
        hash: 'max-hash',
        attempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await verifyOtp({ email, otp: '123456' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many failed attempts');

    const record = await prisma.otp.findFirst({ where: { email } });
    expect(record).toBeNull();
  });
});
