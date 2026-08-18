// DTOs del endpoint POST /api/sap/logisticsCenter
// Fuente: (Swagger) YALM-Create-Logistic-CenterV1.yaml + Documentación Api TerpelPosSAP.docx

export interface CreateLogisticsCenterRequest {
  logisticCenter:     string;
  logisticName:       string;
  logisticCenterType: string;
  regional:           string;
  companyCode:        string;
  customer:           string;
  cashBook:           string;
  costCenter:         string;
  profitCenter:       string;
  city:               string;
  edscod:             string;
  format:             string;
  status:             string;
  modificationDate:   string; // formato: YYYY-MM-DD
  modificationHour:   string; // formato: HH:MM:SS
}

export interface CreateLogisticsCenterResponse {
  message: string;
  status:  number;
  data: {
    empresaId:       number;
    logistic_center: string;
  };
}

export interface ApiError400 {
  code:    string;   // 'INVALID_BODY_CONTENT'
  message: string[];
  status:  number;   // 400
}

export interface ApiError401 {
  tipoError: string; // 'NOT_PAUTHORIZED'
  code:      string; // 'AUTHENTICATION_ERROR'
  message:   string;
  status:    number; // 401
}
