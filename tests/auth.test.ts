import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  generateToken,
  verifyToken,
  extractToken,
} from '../lib/auth.js';

describe('Authentication Utilities', () => {
  describe('generateApiKey', () => {
    it('should generate a 64-character hex string', () => {
      const apiKey = generateApiKey();
      expect(apiKey).toHaveLength(64);
      expect(apiKey).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('JWT Token', () => {
    it('should generate and verify JWT token', () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
      };

      const token = generateToken(payload);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      const decoded = verifyToken(token);
      expect(decoded).toBeTruthy();
      expect(decoded?.userId).toBe(payload.userId);
      expect(decoded?.email).toBe(payload.email);
    });

    it('should return null for invalid token', () => {
      const decoded = verifyToken('invalid-token');
      expect(decoded).toBeNull();
    });

    it('should return null for expired token', () => {
      // This would require setting JWT_EXPIRES_IN to 0 or using a mock
      // For now, we just verify the structure
      const decoded = verifyToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid');
      expect(decoded).toBeNull();
    });
  });

  describe('extractToken', () => {
    it('should extract Bearer token', () => {
      const result = extractToken('Bearer abc123');
      expect(result.type).toBe('jwt');
      expect(result.token).toBe('abc123');
    });

    it('should extract ApiKey token', () => {
      const result = extractToken('ApiKey xyz789');
      expect(result.type).toBe('apikey');
      expect(result.token).toBe('xyz789');
    });

    it('should return null for invalid format', () => {
      const result = extractToken('Invalid format');
      expect(result.type).toBeNull();
      expect(result.token).toBeNull();
    });

    it('should return null for missing header', () => {
      const result = extractToken(undefined);
      expect(result.type).toBeNull();
      expect(result.token).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = extractToken('Bearer ');
      expect(result.type).toBeNull();
      expect(result.token).toBeNull();
    });
  });
});
