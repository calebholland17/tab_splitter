const { defineConfig } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const isRemote = !!process.env.BASE_URL;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  workers: 1,
  use: { baseURL },
  ...(isRemote ? {} : {
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
  }),
});
