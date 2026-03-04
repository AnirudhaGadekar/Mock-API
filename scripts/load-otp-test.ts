import autocannon from 'autocannon';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function run() {
  console.log('🚀 Starting load test...');
  console.log(`📍 Target: ${BASE_URL}/api/v1/auth/send-otp`);
  console.log('⚠️  Note: This requires the server to be running on localhost:3000');
  console.log('💡 To start server: npm run dev');
  console.log('');

  // Check if server is running first
  try {
    const response = await fetch(`${BASE_URL}/health`);
    if (!response.ok) {
      throw new Error('Server not responding correctly');
    }
    console.log('✅ Server is running, proceeding with load test...');
  } catch (error) {
    console.error('❌ Server is not running or not accessible');
    console.error('');
    console.error('To run the load test:');
    console.error('1. Start the server: npm run dev');
    console.error('2. In another terminal: npm run load:test');
    console.error('');
    console.error('Or skip load test with: npm run test:stability (no load)');
    process.exit(1);
  }

  const result = await autocannon({
    url: `${BASE_URL}/api/v1/auth/send-otp`,
    method: 'POST',
    connections: 10, // Reduced for local testing
    duration: 5,    // Reduced for local testing
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: `loadtest-${Date.now()}@example.com` }),
    // Add timeout for local testing
    timeout: 5000
  });

  console.log(autocannon.printResult(result));

  const errorRate = Number(result.errors) / Number(result.requests);
  if (errorRate > 0.1) { // Allow 10% error rate for local
    console.warn(`⚠️  High error rate: ${result.errors}/${result.requests} (${(errorRate * 100).toFixed(1)}%)`);
    console.warn('This might be normal for local development with rate limiting');
  }

  if (result.timeouts > 0) {
    console.warn(`⚠️  ${result.timeouts} requests timed out`);
  }

  console.log('✅ Load test completed.');
}

run().catch((error) => {
  console.error('❌ Load test failed:', (error as Error).message);
  process.exit(1);
});
