// DTOs del endpoint POST /api/sap/customer (host WS — ws.fullcopy.terpel.sclbox.com)
// Fuente: Colección Postman oficial "Servicios Integración SAP".

export interface CreateCustomerRequest {
  customerCode:     string; // Código cliente SAP (requerido)
  idNumber:         string; // Número de identificación (requerido)
  idTypeCode:       string; // Código tipo de identificación (requerido)
  businessName:     string; // Razón social (requerido)
  telephoneNumber:  string; // Teléfono (requerido)
  email:            string; // Correo electrónico (requerido)
  customerType:     string; // Tipo de cliente, ej: Credito (requerido)
  status:           string; // Estado, ej: Activo (requerido)
  companyCode:      string; // Código de sociedad SAP (requerido)
  salesOffice:      string; // Oficina de ventas (requerido)
  cityCode:         string; // Código de ciudad (requerido)
  countryCode:      string; // Código de país, ej: CO (requerido)
  departmentCode:   string; // Código de departamento (requerido)
  modificationDate: string; // YYYY-MM-DD (requerido)
  modificationHour: string; // HH:MM:SS (requerido)
}

export interface UpdateCustomerRequest extends Partial<Omit<CreateCustomerRequest, 'customerCode'>> {
  customerCode: string; // único campo obligatorio en modificación
}

export interface CustomerResponse {
  status:  number;
  message: string;
  data:    object;
}
