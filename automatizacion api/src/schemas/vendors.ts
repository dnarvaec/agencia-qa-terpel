// DTOs del endpoint POST /api/sap/vendors
// Usado tanto para crear como para modificar proveedores.

export interface CreateVendorRequest {
  vendor:              string;       // Código SAP Proveedor (requerido)
  vendorNit:           string;       // NIT del proveedor (requerido)
  vendorName:          string;       // Razón social (max 15, requerido)
  vendorComercialName: string;       // Nombre comercial (max 35, requerido)
  status:              string;       // Estado (1 char, requerido)
  modificationDate:    string;       // YYYY-MM-DD (requerido)
  modificationHour:    string;       // HH:MM:SS (requerido)
}

export interface UpdateVendorRequest extends Partial<Omit<CreateVendorRequest, 'vendor'>> {
  vendor: string; // único campo obligatorio en modificación
}

export interface VendorResponse {
  status:  number;
  message: string;
  data:    object;
}
