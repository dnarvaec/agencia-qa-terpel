import { test as base, APIRequestContext, request } from '@playwright/test';
import { env } from '@utils/env';
import { SsoApi } from '@apis/SsoApi';
import { LogisticsCenterApi } from '@apis/LogisticsCenterApi';
import { VendorsApi } from '@apis/VendorsApi';
import { ProductsApi } from '@apis/ProductsApi';
import { CustomerApi } from '@apis/CustomerApi';
import { RemissionApi } from '@apis/RemissionApi';
import type { GenerateTokenResponse } from '@schemas/sso';

type ApiFixtures = {
  /** Contexto HTTP sin autenticación — para pruebas de endpoints públicos o de seguridad (401) */
  apiContext: APIRequestContext;
  /** Objeto API del servicio SSO (no requiere autenticación) */
  ssoApi: SsoApi;
  /**
   * Contexto HTTP con token Bearer generado dinámicamente via SSO justo antes del test.
   * El token oficial vence a los ~30 segundos, por lo que SIEMPRE se genera uno nuevo
   * (nunca se reutiliza entre tests) al resolver este fixture.
   */
  authenticatedContext: APIRequestContext;

  /** Centro logístico (EDS) — host SAP */
  logisticsCenterApi: LogisticsCenterApi;
  /** Igual que logisticsCenterApi pero sin token — para el caso "sin Authorization" (401) */
  logisticsCenterApiNoAuth: LogisticsCenterApi;

  /** Proveedores — host WS */
  vendorsApi: VendorsApi;
  vendorsApiNoAuth: VendorsApi;

  /** Productos — host WS */
  productsApi: ProductsApi;
  productsApiNoAuth: ProductsApi;

  /** Clientes — host WS */
  customerApi: CustomerApi;
  customerApiNoAuth: CustomerApi;

  /** Remisiones — host SAP */
  remissionApi: RemissionApi;
  remissionApiNoAuth: RemissionApi;
};

export const test = base.extend<ApiFixtures>({
  apiContext: async ({}, use) => {
    const context = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    await use(context);
    await context.dispose();
  },

  ssoApi: async ({ apiContext }, use) => {
    await use(new SsoApi(apiContext, env.ssoUrl));
  },

  authenticatedContext: async ({ apiContext, ssoApi }, use) => {
    if (!env.publicKey) {
      throw new Error('API_PUBLIC_KEY no está definida en .env. Es requerida para generar el token SSO.');
    }
    // Se genera un token nuevo en cada resolución del fixture (vigencia ~30s)
    const tokenRes = await ssoApi.generateToken({ public_key: env.publicKey });
    const body = await tokenRes.json() as GenerateTokenResponse;
    if (!tokenRes.ok() || !body.token) {
      throw new Error(`No se pudo generar el token SSO (HTTP ${tokenRes.status()}): ${JSON.stringify(body)}`);
    }

    const context = await request.newContext({
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${body.token}`,
      },
    });
    await use(context);
    await context.dispose();
  },

  logisticsCenterApi:       async ({ authenticatedContext }, use) => { await use(new LogisticsCenterApi(authenticatedContext, env.sapApiUrl)); },
  logisticsCenterApiNoAuth: async ({ apiContext }, use)          => { await use(new LogisticsCenterApi(apiContext, env.sapApiUrl)); },

  vendorsApi:       async ({ authenticatedContext }, use) => { await use(new VendorsApi(authenticatedContext, env.wsApiUrl)); },
  vendorsApiNoAuth: async ({ apiContext }, use)          => { await use(new VendorsApi(apiContext, env.wsApiUrl)); },

  productsApi:       async ({ authenticatedContext }, use) => { await use(new ProductsApi(authenticatedContext, env.wsApiUrl)); },
  productsApiNoAuth: async ({ apiContext }, use)          => { await use(new ProductsApi(apiContext, env.wsApiUrl)); },

  customerApi:       async ({ authenticatedContext }, use) => { await use(new CustomerApi(authenticatedContext, env.wsApiUrl)); },
  customerApiNoAuth: async ({ apiContext }, use)          => { await use(new CustomerApi(apiContext, env.wsApiUrl)); },

  remissionApi:       async ({ authenticatedContext }, use) => { await use(new RemissionApi(authenticatedContext, env.sapApiUrl)); },
  remissionApiNoAuth: async ({ apiContext }, use)          => { await use(new RemissionApi(apiContext, env.sapApiUrl)); },
});

export { expect } from '@playwright/test';

