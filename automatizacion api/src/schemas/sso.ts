// DTOs del endpoint POST /api/v1/authentication/generate-token
// Token válido por ~30 segundos: debe generarse de forma dinámica justo antes
// de cada test/petición autenticada (ver src/fixtures/api.fixture.ts).

export interface GenerateTokenRequest {
  public_key: string;
}

export interface GenerateTokenResponse {
  status:  number;
  message: string;
  token:   string;
}

export interface SsoError400 {
  status:    number;
  message:   string;   // 'public_key is not allowed to be empty'
  code:      string;   // 'INVALID_BODY_CONTENT'
  tipoError: string;   // 'INVALID VALUES'
}

export interface SsoError401 {
  status:  number;
  error:   string;     // 'WRONG_CREDENTIALS'
  message: string;     // 'Invalid Key'
}
