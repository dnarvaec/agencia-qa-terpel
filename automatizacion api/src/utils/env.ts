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
  apiUrl:    requireEnv('API_URL'),
  ssoUrl:    requireEnv('SSO_URL'),
  publicKey: optionalEnv('API_PUBLIC_KEY'),  // para fixture con SSO auto-login
  apiToken:  optionalEnv('API_TOKEN'),       // token estático alternativo
  nodeEnv:   optionalEnv('NODE_ENV', 'development'),
} as const;
