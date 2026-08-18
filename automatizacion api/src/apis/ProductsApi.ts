import { BaseApi } from './BaseApi';
import type { CreateProductRequest, UpdateProductRequest } from '@schemas/products';

export class ProductsApi extends BaseApi {
  async create(payload: CreateProductRequest) {
    return this.post('/api/sap/products', payload);
  }

  async update(payload: UpdateProductRequest) {
    return this.post('/api/sap/products', payload);
  }
}
