import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });
config({ path: '.env' });

// Mock environment variables if not set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const defaultTestDb = 'postgresql://MockUrl:MockUrl_pass@localhost:5432/MockUrl_test?schema=public';
const defaultLocalDb = 'postgresql://MockUrl:MockUrl_pass@localhost:5432/MockUrl?schema=public';
const useIsolatedTestDb = process.env.USE_ISOLATED_TEST_DB === 'true';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = useIsolatedTestDb ? defaultTestDb : defaultLocalDb;
} else if (!useIsolatedTestDb && process.env.DATABASE_URL.includes('MockUrl_test')) {
  // Allow running tests even when isolated test DB has not been provisioned locally.
  process.env.DATABASE_URL = defaultLocalDb;
}
process.env.DIRECT_DATABASE_URL = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
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
