import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Variable de entorno requerida no definida: ${key}`);
  return value;
}

export const env = {
  appUrl:       requireEnv('APP_URL'),
  defaultUser:  requireEnv('DEFAULT_USER'),
  defaultPassword: requireEnv('DEFAULT_PASSWORD'),
  nodeEnv:      process.env.NODE_ENV ?? 'development',
} as const;
