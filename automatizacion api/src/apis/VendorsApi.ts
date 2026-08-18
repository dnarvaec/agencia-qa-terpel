import { BaseApi } from './BaseApi';
import type { CreateVendorRequest, UpdateVendorRequest } from '@schemas/vendors';

export class VendorsApi extends BaseApi {
  async create(payload: CreateVendorRequest) {
    return this.post('/api/sap/vendors', payload);
  }

  async update(payload: UpdateVendorRequest) {
    return this.post('/api/sap/vendors', payload);
  }
}
