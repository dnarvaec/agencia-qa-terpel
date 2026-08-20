// DTOs del endpoint POST /api/sap/product (host WS — ws.fullcopy.terpel.sclbox.com)
// Fuente: Colección Postman oficial "Servicios Integración SAP".
// salesUnit, conversionFactor, volume, purchaseTAXClassification y purchaseVATValue
// son opcionales: la colección muestra ejemplos donde se omiten según el tipo de producto.
// Para modificar, solo 'product' es obligatorio; el resto es opcional.

export interface CreateProductRequest {
  product:                    string; // Código producto SAP (requerido)
  productDescription:         string; // Descripción (requerido)
  baseUnit:                   string; // Unidad de medida base (requerido)
  productType:                string; // Tipo producto, ej: FERT, ZTER, DIEN, HAWA (requerido)
  productHierarchy:           string; // Jerarquía de producto SAP (requerido)
  productLine:                string; // Línea producto (requerido)
  productGroup:               string; // Grupo producto (requerido)
  salesTAXClassification:     string; // Clasificación IVA ventas (requerido)
  salesVATValue:               string; // Valor IVA ventas (requerido)
  status:                     string; // Estado (1 char, requerido)
  modificationDate:           string; // YYYY-MM-DD (requerido)
  modificationHour:           string; // HH:MM:SS (requerido)
  salesUnit?:                 string; // Unidad de medida de venta (opcional)
  conversionFactor?:          number; // Factor de conversión (opcional)
  volume?:                    number; // Volumen (opcional)
  purchaseTAXClassification?: string; // Clasificación IVA compras (opcional)
  purchaseVATValue?:          string; // Valor IVA compras (opcional)
}

export interface UpdateProductRequest extends Partial<Omit<CreateProductRequest, 'product'>> {
  product: string; // único campo obligatorio en modificación
}

export interface ProductResponse {
  status:  number;
  message: string;
  data:    object;
}
