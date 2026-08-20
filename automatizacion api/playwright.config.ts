import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

// Falla rápido si falta alguna variable requerida para consumir la API SAP
for (const key of ['SAP_API_URL', 'WS_API_URL', 'SSO_URL']) {
  if (!process.env[key]) throw new Error(`${key} no está definida en el archivo .env`);
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [
    ['html', { outputFolder: './reports', open: 'never' }],
    ['json', { outputFile: './reports/results.json' }],
    ['list'],
  ],
  use: {
    // Sin baseURL fija: cada API Object construye su URL absoluta (host SAP o host WS)
    extraHTTPHeaders: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    ignoreHTTPSErrors: true,
    // Captura trazas con request/response completo para auditoría
    trace: 'on',
  },
});

