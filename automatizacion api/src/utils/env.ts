import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Variable de entorno requerida no definida: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const env = {
  apiUrl:   requireEnv('API_URL'),
  apiToken: optionalEnv('API_TOKEN'),
  nodeEnv:  optionalEnv('NODE_ENV', 'development'),
} as const;
