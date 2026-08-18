import { BaseApi } from './BaseApi';
import type { CreateLogisticsCenterRequest } from '@schemas/logisticsCenter';

export class LogisticsCenterApi extends BaseApi {
  async create(payload: CreateLogisticsCenterRequest) {
    return this.post('/api/sap/logisticsCenter', payload);
  }
}
