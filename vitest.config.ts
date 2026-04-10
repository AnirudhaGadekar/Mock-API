import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Many suites mutate shared Redis state (flushdb/quit). Run tests single-threaded to avoid cross-suite interference.
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },

    // 👇 Tell vitest where tests are now
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],

    // 👇 Setup file moved outside src
    setupFiles: ['./tests/setup.ts'],

    testTimeout: 10000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',              // optional: exclude tests from coverage
        '**/*.d.ts',
        '**/*.config.*',
        '**/prisma/**',
        '**/types/**'
      ]
    }
  }
});
