import { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Clase base del API Object Pattern.
 * Cada recurso/servicio de la API extiende esta clase y expone
 * sus endpoints como métodos con tipos explícitos de request/response.
 *
 * Uso:
 *   class ProductApi extends BaseApi {
 *     async getAll() { return this.get('/products'); }
 *     async getById(id: number) { return this.get(`/products/${id}`); }
 *     async create(payload: CreateProductDto) { return this.post('/products', payload); }
 *   }
 */
export abstract class BaseApi {
  protected readonly request: APIRequestContext;
  protected readonly baseURL: string;

  constructor(request: APIRequestContext, baseURL: string) {
    this.request = request;
    this.baseURL = baseURL;
  }

  /** Construye la URL completa concatenando baseURL + path del endpoint */
  protected url(path: string): string {
    return `${this.baseURL}${path}`;
  }

  protected async get(
    path: string,
    params?: Record<string, string | number | boolean>
  ): Promise<APIResponse> {
    return this.request.get(this.url(path), { params });
  }

  protected async post(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.post(this.url(path), { data });
  }

  protected async put(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.put(this.url(path), { data });
  }

  protected async patch(path: string, data?: unknown): Promise<APIResponse> {
    return this.request.patch(this.url(path), { data });
  }

  protected async delete(path: string): Promise<APIResponse> {
    return this.request.delete(this.url(path));
  }
}
