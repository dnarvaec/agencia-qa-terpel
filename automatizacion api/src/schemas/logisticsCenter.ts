// DTOs del endpoint POST /api/sap/logisticsCenter
// Fuente: Colección Postman oficial "Servicios Integración SAP" + Documentación Api TerpelPosSAP.docx
// Nota: 'format' es opcional — el payload oficial de Postman no lo envía — y
// 'logisticCenterType' no está restringido al catálogo DEUNA/EDS/KCO/TDC documentado
// en la HU 25062 (la colección oficial usa valores como 'EDSPRO').

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
  format?:            string;
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
