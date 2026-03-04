import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Mock environment variables if not set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// Override DATABASE_URL explicitly to ensure tests don't hit the dev/prod DB
process.env.DATABASE_URL = 'postgresql://MockUrl:MockUrl_pass@localhost:5432/MockUrl_test?schema=public';
process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '16379'; // Ensure it points to the test redis container
// Generate a random dynamic port between 30000 and 40000 to prevent EADDRINUSE collisions across workers
const dynamicPort = Math.floor(Math.random() * 10000) + 30000;
process.env.PORT = String(dynamicPort); // Force server to start on a dynamic port during tests
process.env.TEST_BASE_URL = `http://localhost:${dynamicPort}`; // Force fetch clients to use the assigned port
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-must-be-32-chars-long';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.BASE_MOCK_DOMAIN = 'mockurl.com';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests

import { beforeAll } from 'vitest';
import { start } from '../src/index.js';

// Boot the server before tests run (since index.ts no longer auto-starts)
beforeAll(async () => {
    // Only call start if needed, fastify takes care of port binding.
    // The server listens async, but in setup we can just kick it off.
    start();
    // sleep briefly to let the server bind
    await new Promise(resolve => setTimeout(resolve, 500));
});
