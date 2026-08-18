# Contexto del Proyecto

> Este archivo contiene toda la información específica del cliente y la aplicación bajo prueba.
> **Para migrar la agencia a un nuevo cliente**, modifica únicamente este archivo.
> Los 4 agentes leen este archivo en bootstrap para obtener el contexto necesario.

---

## Proyecto

| Campo | Valor |
|---|---|
| **Nombre del proyecto** | POC Terpel |
| **Cliente** | Terpel S.A. |
| **Alcance** | API REST — TerpelPosSAP |
| **Tipo de pruebas** | API (sin alcance web en esta POC) |

---

## Aplicación Bajo Prueba (AUT)

| Entorno | API TerpelPosSAP | SSO |
|---|---|---|
| **QAS (Pruebas)** | `https://qas.terpel.sclbox.com:18001` | `https://qas.terpel.sclbox.com:7006` |
| **Producción** | `https://nodos-terpelpos-gtic-apimanager-prd-apicast.devitech.group:18001` | `https://nodos-terpelpos-gtic-apimanager-prd-apicast.devitech.group:7006` |

> El entorno activo se configura en `.env` como `API_URL` y `SSO_URL`.

### Autenticación — SSO (Single Sign-On)

**Flujo obligatorio antes de consumir cualquier endpoint protegido**:

1. `POST {SSO_URL}/api/v1/authentication/generate-token`
   - Body: `{ "public_key": "<valor del .env API_PUBLIC_KEY>" }`
   - Response 200: `{ "status": number, "message": string, "token": string }`
   - El token tiene validez de **300 segundos (5 minutos)**
2. Usar el token en el header: `Authorization: Bearer <token>`

**Errores SSO**:

| HTTP | Estructura |
|---|---|
| `400` | `{ status: 400, message: "public_key is not allowed to be empty", code: "INVALID_BODY_CONTENT", tipoError: "INVALID VALUES" }` |
| `401` | `{ status: 401, error: "WRONG_CREDENTIALS", message: "Invalid Key" }` |

---

## Módulos de la Aplicación

### Módulo 1: Centros Logísticos — `POST /api/sap/logisticsCenter`

**Campos del Body**:

| Campo | Tipo | Longitud | Obligatorio | Valores permitidos |
|---|---|---|---|---|
| `logisticCenter` | string | 4 | Sí | Código SAP (ej. `"1OV3"`) |
| `logisticName` | string | 35 | Sí | Nombre del centro |
| `logisticCenterType` | string | 15 | Sí | `DEUNA`, `EDS`, `KCO`, `TDC` |
| `regional` | string | 35 | Sí | Regional (ej. `"NORTE"`) |
| `companyCode` | string | 4 | Sí | Sociedad SAP (ej. `"1000"`) |
| `customer` | string | 10 | Sí | Cliente |
| `cashBook` | string | 10 | Sí | Libro de caja |
| `costCenter` | string | 10 | Sí | Centro de costos SAP |
| `profitCenter` | string | 10 | Sí | Centro de beneficio SAP |
| `city` | string | 35 | Sí | Ciudad |
| `edscod` | string | 10 | Sí | Código único EDS |
| `format` | string | 15 | Sí | `Propia`, `Afiliada`, `Franquicia`, `Masser` (no puede estar vacío) |
| `status` | string | 1 | Sí | Estado (ej. `"A"`) |
| `modificationDate` | string | 8 | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | 6 | Sí | `HH:MM:SS` |

**Respuestas**:

| HTTP | Estructura |
|---|---|
| `200` | `{ message: string, status: 200, data: { empresaId: number, logistic_center: string } }` |
| `400` | `{ code: "INVALID_BODY_CONTENT", message: string[], status: 400 }` |
| `401` | `{ tipoError: "NOT_PAUTHORIZED", code: "AUTHENTICATION_ERROR", message: "DOES NOT HAVE PERMISSIONS", status: 401 }` |

---

### Módulo 2: Proveedores — `POST /api/sap/vendors`

Mismo endpoint para **crear** y **modificar**. En modificación, solo `vendor` es obligatorio.

**Campos del Body**:

| Campo | Tipo | Longitud | Obligatorio (crear) | Descripción |
|---|---|---|---|---|
| `vendor` | string | — | Sí | Código SAP Proveedor |
| `vendorNit` | string | — | Sí | NIT del proveedor |
| `vendorName` | string | 15 | Sí | Razón social |
| `vendorComercialName` | string | 35 | Sí | Nombre comercial |
| `status` | string | 1 | Sí | Estado |
| `modificationDate` | string | 8 | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | 6 | Sí | `HH:MM:SS` |

**Respuestas**: `{ status: number, message: string, data: object }` (200 / 400 / 401)

---

### Módulo 3: Productos — `POST /api/sap/products`

Mismo endpoint para **crear** y **modificar**. En modificación, solo `product` es obligatorio.

**Campos del Body**:

| Campo | Tipo | Obligatorio (crear) | Descripción |
|---|---|---|---|
| `product` | string | Sí | Código producto SAP |
| `productDescription` | string | Sí | Descripción del producto |
| `baseUnit` | string | Sí | Unidad de medida base (ej. `"LT"`) |
| `salesUnit` | string | Sí | Unidad de medida de venta |
| `conversionFactor` | string | Sí | Factor de conversión |
| `productType` | string | Sí | Tipo de producto |
| `volume` | string | Sí | Volumen |
| `productLine` | string | Sí | Línea del producto |
| `productGroup` | string | Sí | Grupo del producto |
| `codigoIvaVentas` | string | Sí | Código IVA ventas |
| `codigoIvaCompras` | string | Sí | Código IVA compras |
| `status` | string (1) | Sí | Estado |
| `modificationDate` | string | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | Sí | `HH:MM:SS` |

**Respuestas**: `{ status: number, message: string, data: object }` (200 / 400 / 401)

---

## Estructura del Proyecto de Automatización API

```
automatizacion api/
├── src/
│   ├── apis/
│   │   ├── BaseApi.ts              ← Clase base HTTP (get/post/put/patch/delete)
│   │   ├── SsoApi.ts               ← POST /api/v1/authentication/generate-token
│   │   ├── LogisticsCenterApi.ts   ← POST /api/sap/logisticsCenter
│   │   ├── VendorsApi.ts           ← POST /api/sap/vendors (crear / modificar)
│   │   └── ProductsApi.ts          ← POST /api/sap/products (crear / modificar)
│   ├── schemas/
│   │   ├── sso.ts                  ← DTOs SSO (GenerateTokenRequest/Response, errores)
│   │   ├── logisticsCenter.ts      ← DTOs Centros Logísticos
│   │   ├── vendors.ts              ← DTOs Proveedores
│   │   └── products.ts             ← DTOs Productos
│   ├── fixtures/
│   │   └── api.fixture.ts          ← apiContext | authenticatedContext | ssoAuthenticatedContext
│   └── utils/
│       ├── env.ts                  ← API_URL, SSO_URL, API_PUBLIC_KEY, API_TOKEN
│       ├── DataLoader.ts           ← Carga archivos JSON de data/
│       └── ResponseValidator.ts    ← Aserciones reutilizables
├── data/
│   ├── sso.json                    ← Payloads SSO (valid, emptyKey, invalidKey)
│   ├── logisticsCenter.json        ← Payloads Centros Logísticos
│   ├── vendors.json                ← Payloads Proveedores
│   └── products.json               ← Payloads Productos
└── tests/
    └── {recurso}/                  ← Specs generados por el agente "Automatizar y Ejecutar"
```

**Aliases de importación** (declarados en `tsconfig.json`):
- `@apis/*` → `src/apis/*`
- `@schemas/*` → `src/schemas/*`
- `@fixtures/*` → `src/fixtures/*`
- `@utils/*` → `src/utils/*`
- `@data/*` → `data/*`

**Fixtures disponibles**:
- `apiContext` → sin autenticación (para probar 401)
- `authenticatedContext` → Bearer token estático desde `API_TOKEN` del .env
- `ssoAuthenticatedContext` → genera token automáticamente via SSO con `API_PUBLIC_KEY`

**Patrón de test obligatorio**:
```typescript
import { test, expect } from '@fixtures/api.fixture';
import { LogisticsCenterApi } from '@apis/LogisticsCenterApi';
import { DataLoader } from '@utils/DataLoader';
import { ResponseValidator } from '@utils/ResponseValidator';
import { env } from '@utils/env';
import type { CreateLogisticsCenterRequest, CreateLogisticsCenterResponse } from '@schemas/logisticsCenter';

const data = DataLoader.load<{ valid: CreateLogisticsCenterRequest }>('logisticsCenter.json');

test.describe('POST /api/sap/logisticsCenter', () => {
  test('descripción del caso', async ({ ssoAuthenticatedContext }) => {
    const api = new LogisticsCenterApi(ssoAuthenticatedContext, env.apiUrl);
    const response = await api.create(data.valid);
    await ResponseValidator.expectStatus(response, 200);
  });
});
```

---

## Credenciales de Prueba

| Variable | Descripción |
|---|---|
| `API_TOKEN` | Bearer token para autenticación (definido en `.env`) |

> Los casos de autenticación negativa usan `apiContext` (sin token) en lugar de `authenticatedContext`.

---

## Comportamientos Conocidos de la Aplicación

- El campo `format` en Centros Logísticos no puede estar vacío → HTTP 400 `INVALID_BODY_CONTENT`
- El campo `public_key` en SSO no puede estar vacío → HTTP 400 `INVALID_BODY_CONTENT`
- Requests sin header `Authorization` → HTTP 401
- Token SSO expira en 300 segundos; usar `ssoAuthenticatedContext` para renovarlo automáticamente
- Los valores permitidos de `logisticCenterType`: `DEUNA`, `EDS`, `KCO`, `TDC`
- Los valores permitidos de `format`: `Propia`, `Afiliada`, `Franquicia`, `Masser`
- La respuesta exitosa de Centros Logísticos retorna `empresaId` (número) y `logistic_center` (código)
- Todas las respuestas de error siguen la estructura: `{ status, code, message }`

---

## Variables de Entorno Requeridas (Definidas en .env)

| Variable | Descripción |
|---|---|
| `AZURE_DEVOPS_ORG_URL` | URL de la organización Azure DevOps |
| `AZURE_DEVOPS_PROJECT` | Nombre del proyecto Azure DevOps |
| `AZURE_DEVOPS_PAT` | Token de acceso personal Azure DevOps |
| `API_URL` | URL base de la API TerpelPosSAP (ej. `https://qas.terpel.sclbox.com:18001`) |
| `SSO_URL` | URL base del SSO (ej. `https://qas.terpel.sclbox.com:7006`) |
| `API_PUBLIC_KEY` | Public key suministrada por TerpelPos para generar tokens |
| `API_TOKEN` | Bearer token estático (alternativa a SSO, útil en CI) |
| `AGENT_UI_PORT` | Puerto del servidor local Express (3000) |
