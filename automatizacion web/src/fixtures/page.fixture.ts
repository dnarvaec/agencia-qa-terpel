import { test as base, Page } from '@playwright/test';
import { env } from '@utils/env';

type PageFixtures = {
  /** Página sin autenticación — para pruebas de login o endpoints públicos */
  unauthenticatedPage: Page;
  /** Página autenticada — el agente completa el flujo de login tras exploración en vivo */
  authenticatedPage: Page;
};

export const test = base.extend<PageFixtures>({
  unauthenticatedPage: async ({ page }, use) => {
    await page.goto(env.appUrl);
    await use(page);
  },

  authenticatedPage: async ({ page }, use) => {
    // Credenciales: env.defaultUser / env.defaultPassword (del .env)
    // El agente "Automatizar y Ejecutar" inyecta aquí el flujo de login
    // descubierto mediante exploración en vivo antes de generar este fixture.
    await page.goto(env.appUrl);
    await use(page);
  },
});

export { expect } from '@playwright/test';
