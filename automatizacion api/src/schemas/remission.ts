// DTOs del endpoint POST /api/sap/remissionSap (host SAP — serviciostg.terpelpos.com)
// Fuente: Colección Postman oficial "Servicios Integración SAP".

export interface RemissionProductItem {
  product:        string; // Código producto SAP (requerido)
  quantity:       number; // Cantidad (requerido)
  unit:           string; // Unidad de medida (requerido)
  salesCostValue: string; // Valor costo de venta (requerido)
}

export interface CreateRemissionRequest {
  delivery:         string;                 // Número de entrega SAP (requerido)
  documentDate:     string;                 // YYYY-MM-DD (requerido)
  wayBill:          string;                 // Guía/albarán de transporte (requerido)
  logisticCenter:   string;                 // Centro logístico origen (requerido)
  supplyingCenter:  string;                 // Centro logístico abastecedor (requerido)
  productList:      RemissionProductItem[]; // Productos remitidos (requerido)
  frontierLaw:      string;                 // Ley de frontera (requerido)
  status:           string;                 // Estado (requerido)
  modificationDate: string;                 // YYYY-MM-DD (requerido)
  modificationHour: string;                 // HH:MM:SS (requerido)
}

export interface RemissionResponse {
  status:  number;
  message: string;
  data:    object;
}
