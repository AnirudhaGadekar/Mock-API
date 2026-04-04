import { execSync, spawn } from 'child_process';
import fs from 'fs';

// Configuration
interface ServiceConfig {
  command: string;
  healthCheck: string;
  startupTime: number;
  port?: number;
  expectedCount?: string;
}

const SERVICES: Record<string, ServiceConfig> = {
  docker: {
    command: 'npm run docker:up',
    healthCheck: 'docker compose ps --services --filter "status=running" | grep -E "postgres|redis" | wc -l',
    expectedCount: '2',
    startupTime: 30000
  },
  backend: {
    command: 'npm run dev',
    healthCheck: 'curl -f -s http://localhost:3000/healthz',
    startupTime: 25000,
    port: 3000
  },
  frontend: {
    command: 'cd frontend && npm run dev',
    healthCheck: 'curl -f -s http://localhost:5173',
    startupTime: 15000,
    port: 5173
  }
};

let activeProcesses: any[] = [];

// Set up environment variables for testing
function setupTestEnvironment() {
  console.log('🔧 Setting up test environment variables...');
  
  const testEnv = {
    NODE_ENV: 'development',
    AUTH_MODE: 'dev-bypass',
    PORT: '3000',
    HOST: '0.0.0.0',
    JWT_SECRET: '1234567890123456789012345678901234567890123456789012345678901234567890',
    JWT_EXPIRES_IN: '7d',
    OTP_SECRET: '12345678901234567890123456789012',
    API_KEY_SECRET: '12345678901234567890123456789012',
    DATABASE_URL: 'postgresql://MockAPI:MockAPI_pass@localhost:5432/MockAPI',
    DIRECT_DATABASE_URL: 'postgresql://MockAPI:MockAPI_pass@localhost:5432/MockAPI',
    REDIS_URL: 'redis://localhost:16379',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '16379',
    REDIS_DB: '0',
    CORS_ORIGIN: 'http://localhost:5173,http://localhost:3000',
    FRONTEND_URL: 'http://localhost:5173',
    BASE_ENDPOINT_URL: 'http://localhost:3000/e',
    LOG_LEVEL: 'info',
    BODY_LIMIT: '1048576'
  };
  
  // Set environment variables
  Object.entries(testEnv).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
      console.log(`  📝 Set ${key}=${value}`);
    }
  });
  
  console.log('✅ Test environment configured');
}

function run(command: string, cwd?: string): string {
  console.log(`🔧 Running: ${command}`);
  try {
    const result = execSync(command, { 
      stdio: 'pipe', 
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 60000 // 1 minute timeout
    });
    return result;
  } catch (error: any) {
    console.error(`❌ Command failed: ${command}`);
    console.error(`Error: ${error.message}`);
    throw error;
  }
}

function spawnProcess(command: string, cwd?: string) {
  console.log(`🚀 Starting: ${command}`);
  const [cmd, ...args] = command.split(' ');
  const childProcess = spawn(cmd, args, {
    cwd: cwd || process.cwd(),
    stdio: 'pipe',
    shell: true,
    detached: false,
    env: { ...process.env } // Pass current environment
  });

  childProcess.stdout?.on('data', (data: Buffer) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`[${command}] ${output}`);
    }
  });

  childProcess.stderr?.on('data', (data: Buffer) => {
    const output = data.toString().trim();
    if (output && !output.includes('WARN') && !output.includes('info')) {
      console.error(`[${command}] ERROR: ${output}`);
    }
  });

  childProcess.on('error', (error: Error) => {
    console.error(`❌ Process error for ${command}:`, error.message);
  });

  childProcess.on('exit', (code: number, signal: string) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`❌ Process ${command} exited with code ${code}`);
    }
  });

  activeProcesses.push(childProcess);
  return childProcess;
}

async function waitForHealthCheck(healthCheck: string, timeout: number, expectedValue?: string): Promise<boolean> {
  const startTime = Date.now();
  let attempts = 0;
  const maxAttempts = Math.floor(timeout / 1000);
  
  console.log(`🔍 Health check: ${healthCheck}`);
  if (expectedValue) {
    console.log(`📊 Expected: ${expectedValue}`);
  }
  
  while (Date.now() - startTime < timeout && attempts < maxAttempts) {
    try {
      const result = run(healthCheck).trim();
      attempts++;
      
      if (expectedValue) {
        if (result === expectedValue) {
          console.log(`✅ Health check passed (attempt ${attempts}/${maxAttempts})`);
          return true;
        } else {
          console.log(`⏳ Health check result: "${result}" (expected: "${expectedValue}")`);
        }
      } else {
        console.log(`✅ Health check passed (attempt ${attempts}/${maxAttempts})`);
        return true;
      }
    } catch (error: any) {
      console.log(`⏳ Health check attempt ${attempts}/${maxAttempts} failed: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.error(`❌ Health check failed after ${attempts} attempts`);
  return false;
}

async function checkPortAvailable(port: number): Promise<boolean> {
  try {
    run(`netstat -an | grep :${port} | grep LISTEN`);
    return false; // Port is in use
  } catch (error) {
    return true; // Port is available
  }
}

async function startService(name: string) {
  const service = SERVICES[name];
  
  console.log(`\n🌟 Starting ${name} service...`);
  
  try {
    // Check if ports are available for backend/frontend
    if (service.port) {
      const portAvailable = await checkPortAvailable(service.port);
      if (!portAvailable) {
        throw new Error(`Port ${service.port} is already in use. Please stop the existing service.`);
      }
    }
    
    // Start the service
    spawnProcess(service.command);
    
    // Wait for startup
    console.log(`⏳ Waiting ${service.startupTime / 1000}s for ${name} to start...`);
    await new Promise(resolve => setTimeout(resolve, service.startupTime));
    
    // Health check
    if (service.healthCheck) {
      const expectedValue = name === 'docker' ? service.expectedCount : undefined;
      const isHealthy = await waitForHealthCheck(service.healthCheck, 45000, expectedValue);
      if (!isHealthy) {
        throw new Error(`${name} health check failed`);
      }
    }
    
    console.log(`✅ ${name} is ready`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to start ${name}:`, error);
    return false;
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up processes...');
  
  // Kill all spawned processes
  for (const childProcess of activeProcesses) {
    try {
      childProcess.kill('SIGTERM');
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Force kill if still running
      try {
        childProcess.kill('SIGKILL');
      } catch (error) {
        // Process already dead
      }
    } catch (error) {
      console.error('Error killing process:', error);
    }
  }
  
  // Stop Docker containers
  try {
    console.log('🐳 Stopping Docker containers...');
    run('npm run docker:down');
  } catch (error) {
    console.error('Error stopping Docker:', error);
  }
  
  console.log('✅ Cleanup completed');
}

async function main() {
  console.log('🚀 Starting full stack verification...');
  console.log('This will start Docker, backend, and frontend services, then run all tests.');
  console.log('');
  
  const startTime = Date.now();
  
  try {
    // Set up test environment
    setupTestEnvironment();
    
    // 1. Start Docker services
    const dockerStarted = await startService('docker');
    if (!dockerStarted) {
      throw new Error('Docker services failed to start');
    }
    
    // 2. Start backend
    const backendStarted = await startService('backend');
    if (!backendStarted) {
      throw new Error('Backend failed to start');
    }
    
    // 3. Start frontend (if exists)
    const frontendExists = fs.existsSync('frontend');
    if (frontendExists) {
      const frontendStarted = await startService('frontend');
      if (!frontendStarted) {
        console.warn('⚠️  Frontend failed to start, continuing with backend tests only');
      }
    } else {
      console.log('ℹ️  Frontend directory not found, skipping frontend startup');
    }
    
    console.log('\n🎯 All services started successfully!');
    console.log('Running comprehensive verification...');
    
    // 4. Run static scans (strict - fail on any issues)
    console.log('\n📋 Running static analysis...');
    run('npm run scan:all');
    
    // 5. Run integration tests (strict)
    console.log('\n🔗 Running integration tests...');
    run('npm run test:integration');
    
    // 6. Run live integration tests (strict - requires running server)
    console.log('\n🌐 Running live integration tests...');
    run('npm run test:integration:live');
    
    // 7. Run stability tests (strict)
    console.log('\n💪 Running stability tests...');
    run('npm run stability:test');
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n🎉 Full stack verification completed successfully in ${duration}s!`);
    
  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.error(`\n❌ Verification failed after ${duration}s:`, error);
    console.error('');
    console.error('To debug issues:');
    console.error('1. Check Docker: docker ps');
    console.error('2. Check logs: docker logs MockAPI-postgres MockAPI-redis');
    console.error('3. Check ports: netstat -an | grep -E "3000|5173|5432|6379|16379"');
    console.error('4. Check environment variables: cat .env');
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received termination signal, cleaning up...');
  await cleanup();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught exception:', error);
  await cleanup();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  await cleanup();
  process.exit(1);
});

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  cleanup();
  process.exit(1);
});
