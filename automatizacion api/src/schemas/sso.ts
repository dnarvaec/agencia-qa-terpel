// DTOs del endpoint POST /api/v1/authentication/generate-token
// Token válido por 300 segundos (~5 minutos). Siempre retorna Bearer token.

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
