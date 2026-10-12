import { defineConfig } from '@playwright/test'
// Workers explicitly set FORCE_COLOR; avoid the inherited conflicting flag.
delete process.env.NO_COLOR

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 30_000,
  use: { trace: 'retain-on-failure' },
  reporter: 'list'
})
