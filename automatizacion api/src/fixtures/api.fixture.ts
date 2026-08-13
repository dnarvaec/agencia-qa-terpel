import { test as base, APIRequestContext, request } from '@playwright/test';
import { env } from '@utils/env';

type ApiFixtures = {
  /** Contexto HTTP sin autenticación — para pruebas de endpoints públicos o de seguridad */
  apiContext: APIRequestContext;
  /** Contexto HTTP con token Bearer — para pruebas de endpoints protegidos */
  authenticatedContext: APIRequestContext;
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
});

export { expect } from '@playwright/test';
