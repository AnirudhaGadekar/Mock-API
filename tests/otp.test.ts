import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  otp: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const generateApiKeyMock = vi.fn(() => 'mock-api-key');
const hashApiKeyMock = vi.fn(() => 'mock-api-key-hash');
const jwtSignMock = vi.fn(() => 'mock-jwt-token');
const sendOtpEmailMock = vi.fn();

vi.mock('../src/lib/db.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: loggerMock,
}));

vi.mock('../src/utils/apiKey.js', () => ({
  generateApiKey: generateApiKeyMock,
  hashApiKey: hashApiKeyMock,
}));

vi.mock('../src/lib/mailer.js', () => ({
  sendOtpEmail: sendOtpEmailMock,
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: jwtSignMock,
  },
}));

const ORIGINAL_ENV = process.env;

function setBaseEnv() {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    OTP_SECRET: 'test-otp-secret-32-chars-long',
    JWT_SECRET: 'test-jwt-secret-32-chars-long',
    JWT_EXPIRY: '3600',
    JWT_EXPIRES_IN: undefined,
    AUTH_MODE: 'otp',
    ALLOW_OTP_FOR_PASSWORD_USERS: 'false',
    API_KEY_COOKIE_MAX_AGE_SECONDS: '3600',
  };
}

function buildOtpHash(otp: string) {
  return crypto
    .createHmac('sha256', process.env.OTP_SECRET as string)
    .update(otp)
    .digest('hex');
}

async function loadOtpModule() {
  return import('../src/auth/otp.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  setBaseEnv();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('OTP auth module', () => {
  describe('env validation', () => {
    it('throws when OTP_SECRET is missing', async () => {
      delete process.env.OTP_SECRET;
      await expect(loadOtpModule()).rejects.toThrow('OTP_SECRET');
    });

    it('throws when JWT_SECRET is missing', async () => {
      delete process.env.JWT_SECRET;
      await expect(loadOtpModule()).rejects.toThrow('JWT_SECRET');
    });

    it('throws when both JWT expiry env vars are missing', async () => {
      delete process.env.JWT_EXPIRY;
      delete process.env.JWT_EXPIRES_IN;
      await expect(loadOtpModule()).rejects.toThrow('JWT_EXPIRY or JWT_EXPIRES_IN');
    });
  });

  describe('sendOtp', () => {
    it('stores OTP for a normalized email', async () => {
      const { sendOtp } = await loadOtpModule();
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.otp.findFirst.mockResolvedValue(null);
      prismaMock.otp.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.otp.create.mockResolvedValue({});

      const result = await sendOtp({ email: '  TEST@Example.com  ' });

      expect(result.success).toBe(true);
      expect(prismaMock.otp.deleteMany).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(prismaMock.otp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            hash: expect.any(String),
            attempts: 0,
          }),
        }),
      );
      expect(sendOtpEmailMock).toHaveBeenCalledWith('test@example.com', expect.stringMatching(/^\d{6}$/));
    });

    it('returns rate-limit error when recent attempts are too high', async () => {
      const { sendOtp } = await loadOtpModule();
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.otp.findFirst.mockResolvedValue({
        id: 'otp1',
        attempts: 3,
      });

      const result = await sendOtp({ email: 'test@example.com' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many OTP requests');
    });

    it('returns devOtp only in dev-bypass mode', async () => {
      process.env.NODE_ENV = 'development';
      process.env.AUTH_MODE = 'dev-bypass';
      const { sendOtp } = await loadOtpModule();

      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.otp.findFirst.mockResolvedValue(null);
      prismaMock.otp.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.otp.create.mockResolvedValue({});

      const result = await sendOtp({ email: 'test@example.com' });

      expect(result.success).toBe(true);
      expect(result.devOtp).toMatch(/^\d{6}$/);
    });

    it('blocks OTP send for deactivated accounts', async () => {
      const { sendOtp } = await loadOtpModule();

      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        accountStatus: 'DEACTIVATED',
        deactivatedAt: new Date(),
      });

      const result = await sendOtp({ email: 'test@example.com' });

      expect(result.success).toBe(false);
      expect(result.code).toBe('ACCOUNT_DEACTIVATED');
      expect(result.statusCode).toBe(403);
      expect(prismaMock.otp.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('verifies valid OTP and issues token', async () => {
      const { verifyOtp } = await loadOtpModule();
      const otp = '123456';
      const otpHash = buildOtpHash(otp);

      prismaMock.otp.findFirst.mockResolvedValue({
        id: 'otp1',
        hash: otpHash,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      prismaMock.otp.delete.mockResolvedValue({});
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: null,
        authProvider: 'EMAIL_OTP',
        password: null,
        accountStatus: 'ACTIVE',
        deactivatedAt: null,
      });

      const result = await verifyOtp({ email: 'test@example.com', otp });

      expect(result.success).toBe(true);
      expect(result.token).toBe('mock-jwt-token');
      expect(result.apiKey).toBe('mock-api-key');
      expect(jwtSignMock).toHaveBeenCalled();
    });

    it('increments attempts when OTP is invalid', async () => {
      const { verifyOtp } = await loadOtpModule();

      prismaMock.otp.findFirst.mockResolvedValue({
        id: 'otp1',
        hash: buildOtpHash('111111'),
        attempts: 1,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      prismaMock.otp.update.mockResolvedValue({});

      const result = await verifyOtp({ email: 'test@example.com', otp: '123456' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid OTP.');
      expect(result.attemptsLeft).toBe(3);
      expect(prismaMock.otp.update).toHaveBeenCalledWith({
        where: { id: 'otp1' },
        data: { attempts: 2 },
      });
    });

    it('allows OTP login for password-backed accounts', async () => {
      const { verifyOtp } = await loadOtpModule();
      const otp = '123456';

      prismaMock.otp.findFirst.mockResolvedValue({
        id: 'otp1',
        hash: buildOtpHash(otp),
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      prismaMock.otp.delete.mockResolvedValue({});
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        authProvider: 'LOCAL',
        password: 'hashed-password',
        username: 'test-user',
        firstName: 'Test',
        lastName: 'User',
        picture: null,
        accountStatus: 'ACTIVE',
        deactivatedAt: null,
        emailVerified: false,
        currentWorkspaceType: 'PERSONAL',
        currentTeamId: null,
      });
      prismaMock.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        authProvider: 'EMAIL_OTP',
        password: 'hashed-password',
        username: 'test-user',
        firstName: 'Test',
        lastName: 'User',
        picture: null,
        accountStatus: 'ACTIVE',
        deactivatedAt: null,
        emailVerified: true,
        currentWorkspaceType: 'PERSONAL',
        currentTeamId: null,
      });

      const result = await verifyOtp({ email: 'test@example.com', otp });

      expect(result.success).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            apiKeyHash: 'mock-api-key-hash',
            authProvider: 'EMAIL_OTP',
            emailVerified: true,
          }),
        }),
      );
    });

    it('blocks OTP verification for deactivated accounts', async () => {
      const { verifyOtp } = await loadOtpModule();
      const otp = '123456';

      prismaMock.otp.findFirst.mockResolvedValue({
        id: 'otp1',
        hash: buildOtpHash(otp),
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      prismaMock.otp.delete.mockResolvedValue({});
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        authProvider: 'EMAIL_OTP',
        password: null,
        username: 'test-user',
        firstName: 'Test',
        lastName: 'User',
        picture: null,
        accountStatus: 'DEACTIVATED',
        deactivatedAt: new Date(),
        emailVerified: true,
        currentWorkspaceType: 'PERSONAL',
        currentTeamId: null,
      });

      const result = await verifyOtp({ email: 'test@example.com', otp });

      expect(result.success).toBe(false);
      expect(result.code).toBe('ACCOUNT_DEACTIVATED');
      expect(result.statusCode).toBe(403);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe('cookie helpers', () => {
    it('returns centralized cookie name and options', async () => {
      const { getApiKeyCookieName, getCookieOptions } = await loadOtpModule();
      const options = getCookieOptions();

      expect(getApiKeyCookieName()).toBe('mockapi_api_key');
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.path).toBe('/');
      expect(options.maxAge).toBe(3600);
    });

    it('supports JWT_EXPIRES_IN fallback when JWT_EXPIRY is unset', async () => {
      delete process.env.JWT_EXPIRY;
      process.env.JWT_EXPIRES_IN = '1h';
      const { getCookieOptions } = await loadOtpModule();

      expect(getCookieOptions().maxAge).toBe(3600);
    });
  });
});
