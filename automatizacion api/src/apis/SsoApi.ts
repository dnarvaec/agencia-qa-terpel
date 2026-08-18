import { BaseApi } from './BaseApi';
import type { GenerateTokenRequest } from '@schemas/sso';

// SSO base URL se configura por separado en env (SSO_URL), distinto al API_URL
export class SsoApi extends BaseApi {
  async generateToken(payload: GenerateTokenRequest) {
    return this.post('/api/v1/authentication/generate-token', payload);
  }
}
