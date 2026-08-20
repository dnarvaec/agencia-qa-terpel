import { BaseApi } from './BaseApi';
import type { CreateCustomerRequest, UpdateCustomerRequest } from '@schemas/customer';

export class CustomerApi extends BaseApi {
  async create(payload: CreateCustomerRequest) {
    return this.post('/api/sap/customer', payload);
  }

  async update(payload: UpdateCustomerRequest) {
    return this.post('/api/sap/customer', payload);
  }
}
