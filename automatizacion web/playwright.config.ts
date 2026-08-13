import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const APP_URL = process.env.APP_URL;
if (!APP_URL) throw new Error('APP_URL no está definida en el archivo .env');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: './reports', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: APP_URL,
    trace: 'off',
    screenshot: 'on',
    video: 'on',
    headless: true,
    locale: 'es-CO',
    // Certificado SSL corporativo NTT DATA — red con inspección SSL
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chrome',
      use: { channel: 'chrome' },
    },
  ],
});
