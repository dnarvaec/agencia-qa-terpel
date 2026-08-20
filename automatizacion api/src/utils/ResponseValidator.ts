import { APIResponse, expect } from '@playwright/test';

/**
 * Colección de aserciones reutilizables para respuestas de API.
 * Centraliza las validaciones comunes para evitar repetición en los specs.
 */
export class ResponseValidator {

  static async expectStatus(response: APIResponse, status: number): Promise<void> {
    expect(
      response.status(),
      `Se esperaba HTTP ${status}, se recibió ${response.status()}`
    ).toBe(status);
  }

  /** Valida que la respuesta sea 2xx y parsea el body */
  static async expectOk<T = unknown>(response: APIResponse): Promise<T> {
    expect(response.ok(), `La respuesta no fue exitosa: ${response.status()}`).toBeTruthy();
    return response.json() as Promise<T>;
  }

  /** Valida que el body contenga al menos las propiedades indicadas */
  static async expectBody<T extends object>(
    response: APIResponse,
    partial: Partial<T>
  ): Promise<T> {
    const body = await response.json() as T;
    expect(body as Record<string, unknown>).toMatchObject(partial as Record<string, unknown>);
    return body;
  }

  static async expectCreated<T = unknown>(response: APIResponse): Promise<T> {
    await ResponseValidator.expectStatus(response, 201);
    return response.json() as Promise<T>;
  }

  static async expectNoContent(response: APIResponse): Promise<void> {
    await ResponseValidator.expectStatus(response, 204);
  }

  static async expectBadRequest(response: APIResponse): Promise<void> {
    await ResponseValidator.expectStatus(response, 400);
  }

  static async expectUnauthorized(response: APIResponse): Promise<void> {
    await ResponseValidator.expectStatus(response, 401);
  }

  static async expectForbidden(response: APIResponse): Promise<void> {
    await ResponseValidator.expectStatus(response, 403);
  }

  static async expectNotFound(response: APIResponse): Promise<void> {
    await ResponseValidator.expectStatus(response, 404);
  }

  static async expectUnprocessable(response: APIResponse): Promise<void> {
    await ResponseValidator.expectStatus(response, 422);
  }
}
