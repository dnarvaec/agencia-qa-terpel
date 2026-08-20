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
  // Host SAP (serviciostg.terpelpos.com:7003) — logisticsCenter, remissionSap
  sapApiUrl: requireEnv('SAP_API_URL'),
  // Host WS/fullcopy (ws.fullcopy.terpel.sclbox.com:18001) — vendors, product, customer
  wsApiUrl:  requireEnv('WS_API_URL'),
  // Host SSO (serviciostg.terpelpos.com:7006) — generate-token
  ssoUrl:    requireEnv('SSO_URL'),
  publicKey: optionalEnv('API_PUBLIC_KEY'),  // requerida para generar el token SSO (vigencia ~30s)
  nodeEnv:   optionalEnv('NODE_ENV', 'development'),
} as const;
