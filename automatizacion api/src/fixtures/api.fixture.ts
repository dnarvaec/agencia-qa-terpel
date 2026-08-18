import { test as base, APIRequestContext, request } from '@playwright/test';
import { env } from '@utils/env';
import type { GenerateTokenResponse } from '@schemas/sso';

type ApiFixtures = {
  /** Contexto HTTP sin autenticación — para pruebas de endpoints públicos o de seguridad */
  apiContext: APIRequestContext;
  /** Contexto HTTP con token Bearer estático (API_TOKEN del .env) */
  authenticatedContext: APIRequestContext;
  /** Contexto HTTP con token generado automáticamente via SSO (usa API_PUBLIC_KEY del .env) */
  ssoAuthenticatedContext: APIRequestContext;
};

export const test = base.extend<ApiFixtures>({
  apiContext: async ({}, use) => {
    const context = await request.newContext({
      baseURL: env.apiUrl,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    await use(context);
    await context.dispose();
  },

  authenticatedContext: async ({}, use) => {
    const context = await request.newContext({
      baseURL: env.apiUrl,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.apiToken}`,
      },
    });
    await use(context);
    await context.dispose();
  },

  ssoAuthenticatedContext: async ({}, use) => {
    // Genera el token via SSO antes de cada test que use este fixture
    const ssoCtx = await request.newContext({
      baseURL: env.ssoUrl,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
    const tokenRes = await ssoCtx.post('/api/v1/authentication/generate-token', {
      data: { public_key: env.publicKey },
    });
    const { token } = await tokenRes.json() as GenerateTokenResponse;
    await ssoCtx.dispose();

    const context = await request.newContext({
      baseURL: env.apiUrl,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    await use(context);
    await context.dispose();
  },
});

export { expect } from '@playwright/test';
