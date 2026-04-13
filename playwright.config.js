const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  workers: 1,
  use: { baseURL: 'http://localhost:3001' },
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3001/',
    readyTimeout: 15000,
    reuseExistingServer: false,
    env: {
      PORT: '3001',
      DB_PATH: ':memory:',
      ANTHROPIC_API_KEY: 'test-key',
    },
  },
});
