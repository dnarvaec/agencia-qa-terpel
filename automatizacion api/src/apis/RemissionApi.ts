import { BaseApi } from './BaseApi';
import type { CreateRemissionRequest } from '@schemas/remission';

export class RemissionApi extends BaseApi {
  async create(payload: CreateRemissionRequest) {
    return this.post('/api/sap/remissionSap', payload);
  }
}
