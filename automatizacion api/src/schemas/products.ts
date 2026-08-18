// DTOs del endpoint POST /api/sap/products
// Para modificar, solo 'product' es obligatorio; el resto es opcional.

export interface CreateProductRequest {
  product:            string; // Código producto SAP (requerido)
  productDescription: string; // Descripción (requerido)
  baseUnit:           string; // Unidad de medida base (requerido)
  salesUnit:          string; // Unidad de medida de venta (requerido)
  conversionFactor:   string; // Factor de conversión (requerido)
  productType:        string; // Tipo producto (requerido)
  volume:             string; // Volumen (requerido)
  productLine:        string; // Línea producto (requerido)
  productGroup:       string; // Grupo producto (requerido)
  codigoIvaVentas:    string; // Código IVA Ventas (requerido)
  codigoIvaCompras:   string; // Código IVA Compras (requerido)
  status:             string; // Estado (1 char, requerido)
  modificationDate:   string; // YYYY-MM-DD (requerido)
  modificationHour:   string; // HH:MM:SS (requerido)
}

export interface UpdateProductRequest extends Partial<Omit<CreateProductRequest, 'product'>> {
  product: string; // único campo obligatorio en modificación
}

export interface ProductResponse {
  status:  number;
  message: string;
  data:    object;
}
