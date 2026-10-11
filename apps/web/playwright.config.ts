import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const serverPort = 8091;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: [
    {
      command: 'go run .',
      cwd: '../server',
      env: {
        ERGON_ADDR: `:${serverPort}`,
        ERGON_DB: join(tmpdir(), `ergon-e2e-${Date.now()}.db`),
        ERGON_REGISTRATION: 'open',
      },
      url: `http://localhost:${serverPort}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build && pnpm preview --port ${port} --strictPort`,
      env: { ERGON_SERVER: `http://localhost:${serverPort}` },
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
