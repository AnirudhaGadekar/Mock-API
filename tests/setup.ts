import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Mock environment variables if not set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/MockUrl_test?schema=public';
process.env.DIRECT_DATABASE_URL = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-must-be-32-chars-long';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests
