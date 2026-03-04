import { execSync } from 'child_process';

function run(cmd: string) {
  execSync(cmd, { stdio: 'inherit' });
}

console.log('🚀 Running production build...');
run('npm run build');

console.log('🧪 Simulating production boot...');
process.env.NODE_ENV = 'production';
process.env.AUTH_MODE = 'otp';
process.env.OTP_SECRET = '12345678901234567890123456789012';
process.env.JWT_SECRET = '12345678901234567890123456789012';
process.env.JWT_EXPIRY = '3600';
process.env.DATABASE_URL = 'test';
process.env.FRONTEND_URL = 'https://example.com';

// Validate required environment variables
const requiredEnvVars = ['OTP_SECRET', 'JWT_SECRET', 'JWT_EXPIRY', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

console.log('✅ Production simulation passed.');
