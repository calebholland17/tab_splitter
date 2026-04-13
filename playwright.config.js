const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: { baseURL: 'http://localhost:3001' },
  webServer: {
    command: 'node server.js',
    port: 3001,
    env: {
      PORT: '3001',
      DB_PATH: ':memory:',
      ANTHROPIC_API_KEY: 'test-key',
    },
    reuseExistingServer: false,
  },
});
