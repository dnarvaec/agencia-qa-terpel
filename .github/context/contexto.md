# Contexto del Proyecto

> Este archivo contiene toda la información específica del cliente y la aplicación bajo prueba.
> **Para migrar la agencia a un nuevo cliente**, modifica únicamente este archivo.
> Los agentes leen este archivo en bootstrap para obtener el contexto necesario.

---

## Proyecto

| Campo | Valor |
|---|---|
| **Nombre del proyecto** | POC Terpel |
| **Cliente** | Terpel S.A. |
| **Alcance** | API REST — TerpelPosSAP (Servicios Integración SAP) |
| **Tipo de pruebas** | API (sin alcance web en esta POC) |

---

## Aplicación Bajo Prueba (AUT)

La API usa **dos hosts distintos** según el recurso, más un host dedicado para el SSO:

| Host | URL | Recursos |
|---|---|---|
| **SAP** (TG/QAS) | `https://serviciostg.terpelpos.com:7003` | logisticsCenter, remissionSap |
| **WS/fullcopy** (QAS) | `https://ws.fullcopy.terpel.sclbox.com:18001` | vendors, product, customer |
| **SSO** (TG/QAS) | `https://serviciostg.terpelpos.com:7006` | generate-token |

> Los entornos activos se configuran en `.env` como `SAP_API_URL`, `WS_API_URL` y `SSO_URL`.

---

### Autenticación — SSO (Single Sign-On)

**Flujo obligatorio antes de consumir cualquier endpoint protegido:**

1. `POST {SSO_URL}/api/v1/authentication/generate-token`
   - Body: `{ "public_key": "<valor del .env API_PUBLIC_KEY>" }`
   - Response 200: `{ "status": number, "message": string, "token": string }`
   - **El token vence a los ~30 segundos**: se debe generar un token nuevo antes de cada test o petición autenticada. **Nunca reutilizar tokens entre tests.**
2. Usar el token en el header: `Authorization: Bearer <token>`

**Errores SSO:**

| HTTP | Estructura |
|---|---|
| `400` | `{ status: 400, message: "public_key is not allowed to be empty", code: "INVALID_BODY_CONTENT", tipoError: "INVALID VALUES" }` |
| `401` | `{ status: 401, error: "WRONG_CREDENTIALS", message: "Invalid Key" }` |

---

## Módulos de la Aplicación

### Módulo 1: Centros Logísticos — `POST /api/sap/logisticsCenter` — Host: SAP

**Fuente de verdad:** Colección Postman oficial "Servicios Integración SAP"

**Campos del Body:**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `logisticCenter` | string | Sí | Código SAP del centro (ej. `"1O1W"`) — identificador único, no se puede cambiar salvo retoma |
| `logisticName` | string | Sí | Nombre del centro (ej. `"EDS LA 40"`) |
| `logisticCenterType` | string | Sí | Tipo de centro (ej. `"EDSPRO"`) — sin enum restringido en la colección real |
| `regional` | string | Sí | Código de regional (ej. `"170"`) |
| `companyCode` | string | Sí | Código de sociedad SAP (ej. `"1800"`) |
| `customer` | string | Sí | Código de cliente (ej. `"0000010476"`) |
| `cashBook` | string | Sí | Libro de caja (ej. `"0476"`) |
| `costCenter` | string | Sí | Centro de costos SAP (ej. `"1824CP001"`) |
| `profitCenter` | string | Sí | Centro de beneficio SAP (ej. `"1827PP033"`) |
| `city` | string | Sí | Ciudad (ej. `"IBAGUE"`) — el sistema asigna país y departamento automáticamente |
| `edscod` | string | Sí | Código único EDS (ej. `"EDS9938"`) |
| `format` | string | **No** | Tipo de estación (ej. `"ESTACION"`) — opcional; la colección oficial no lo envía |
| `status` | string | Sí | Estado (ej. `"1"`) |
| `modificationDate` | string | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | Sí | `HH:MM:SS` |

**Respuestas:**

| HTTP | Estructura |
|---|---|
| `200` | `{ message: string, status: 200, data: { empresaId: number, logistic_center: string } }` |
| `400` | `{ code: "INVALID_BODY_CONTENT", message: string[], status: 400 }` |
| `401` | `{ tipoError: "NOT_PAUTHORIZED", code: "AUTHENTICATION_ERROR", message: "DOES NOT HAVE PERMISSIONS", status: 401 }` |

**Reglas de negocio (HU 25062):**
- País y departamento se asignan automáticamente según la ciudad recibida.
- Dirección, correo y teléfono se crean vacíos (se rellenan manualmente después).
- `logisticCenter` es el identificador único; no se puede modificar, salvo retoma MASSER → Franquicia.
- Se crea una cola en el datalake MDM por cada EDS (trazabilidad).

---

### Módulo 2: Proveedores — `POST /api/sap/vendors/` — Host: WS

Mismo endpoint para **crear** y **modificar**. En modificación, solo `vendor` es obligatorio.

**Campos del Body:**

| Campo | Tipo | Obligatorio (crear) | Descripción |
|---|---|---|---|
| `vendor` | string | Sí | Código SAP Proveedor (ej. `"000895"`) |
| `vendorNit` | string | Sí | NIT del proveedor (ej. `"10417455"`) |
| `vendorName` | string | Sí | Razón social (máx. 15 chars, ej. `"ELECTRONICOS SAS"`) |
| `vendorComercialName` | string | Sí | Nombre comercial (máx. 35 chars, ej. `"DEV"`) |
| `status` | string | Sí | Estado (ej. `"1"`) |
| `modificationDate` | string | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | Sí | `HH:MM:SS` |

**Respuestas:** `{ status: number, message: string, data: object }` (200 / 400 / 401)

---

### Módulo 3: Productos — `POST /api/sap/product` — Host: WS

> ⚠️ El endpoint es **`/api/sap/product`** (singular), no `products`.

Mismo endpoint para **crear** y **modificar**. En modificación, solo `product` es obligatorio.

**Campos del Body:**

| Campo | Tipo | Obligatorio (crear) | Descripción |
|---|---|---|---|
| `product` | string | Sí | Código producto SAP (ej. `"000000000000002342"`) |
| `productDescription` | string | Sí | Descripción (ej. `"BIOACEM B50"`) |
| `baseUnit` | string | Sí | Unidad de medida base (ej. `"UG6"`) |
| `productType` | string | Sí | Tipo de producto (ej. `"FERT"`, `"ZTER"`, `"DIEN"`, `"HAWA"`) |
| `productHierarchy` | string | Sí | Jerarquía SAP (ej. `"001070000300000001"`) |
| `productLine` | string | Sí | Línea del producto (ej. `"04"`) |
| `productGroup` | string | Sí | Grupo del producto (ej. `"M001"`) |
| `salesTAXClassification` | string | Sí | Clasificación IVA ventas (ej. `"A"`) |
| `salesVATValue` | string | Sí | Valor IVA ventas (ej. `"19"`) |
| `status` | string | Sí | Estado (ej. `"1"`) |
| `modificationDate` | string | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | Sí | `HH:MM:SS` |
| `salesUnit` | string | No | Unidad de medida de venta |
| `conversionFactor` | number | No | Factor de conversión |
| `volume` | number | No | Volumen |
| `purchaseTAXClassification` | string | No | Clasificación IVA compras |
| `purchaseVATValue` | string | No | Valor IVA compras |

**Respuestas:** `{ status: number, message: string, data: object }` (200 / 400 / 401)

---

### Módulo 4: Clientes — `POST /api/sap/customer` — Host: WS

**Campos del Body:**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `customerCode` | string | Sí | Código cliente SAP (ej. `"0010261681"`) |
| `idNumber` | string | Sí | Número de identificación (ej. `"9002225127"`) |
| `idTypeCode` | string | Sí | Código tipo ID (ej. `"31"`) |
| `businessName` | string | Sí | Razón social (ej. `"SEPTICLEAN SAS ESP"`) |
| `telephoneNumber` | string | Sí | Teléfono |
| `email` | string | Sí | Correo electrónico |
| `customerType` | string | Sí | Tipo (ej. `"Credito"`) |
| `status` | string | Sí | Estado (ej. `"Activo"`) |
| `companyCode` | string | Sí | Código de sociedad SAP |
| `salesOffice` | string | Sí | Oficina de ventas |
| `cityCode` | string | Sí | Código de ciudad |
| `countryCode` | string | Sí | Código de país (ej. `"CO"`) |
| `departmentCode` | string | Sí | Código de departamento |
| `modificationDate` | string | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | Sí | `HH:MM:SS` |

**Respuestas:** `{ status: number, message: string, data: object }` (200 / 400 / 401)

---

### Módulo 5: Remisiones — `POST /api/sap/remissionSap` — Host: SAP

**Campos del Body:**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `delivery` | string | Sí | Número de entrega SAP (ej. `"1483115903"`) |
| `documentDate` | string | Sí | `YYYY-MM-DD` |
| `wayBill` | string | Sí | Guía/albarán de transporte |
| `logisticCenter` | string | Sí | Centro logístico origen |
| `supplyingCenter` | string | Sí | Centro logístico abastecedor |
| `productList` | array | Sí | Lista de productos (ver estructura abajo) |
| `frontierLaw` | string | Sí | Ley de frontera |
| `status` | string | Sí | Estado |
| `modificationDate` | string | Sí | `YYYY-MM-DD` |
| `modificationHour` | string | Sí | `HH:MM:SS` |

**Estructura de cada ítem en `productList`:**

| Campo | Tipo | Descripción |
|---|---|---|
| `product` | string | Código producto SAP |
| `quantity` | number | Cantidad |
| `unit` | string | Unidad de medida |
| `salesCostValue` | string | Valor costo de venta |

**Respuestas:** `{ status: number, message: string, data: object }` (200 / 400 / 401)

---

## Estructura del Proyecto de Automatización API

```
automatizacion api/
├── src/
│   ├── apis/
│   │   ├── BaseApi.ts              ← Clase base HTTP (get/post/put/patch/delete)
│   │   ├── SsoApi.ts               ← POST /api/v1/authentication/generate-token
│   │   ├── LogisticsCenterApi.ts   ← POST /api/sap/logisticsCenter  (host SAP)
│   │   ├── VendorsApi.ts           ← POST /api/sap/vendors/          (host WS)
│   │   ├── ProductsApi.ts          ← POST /api/sap/product           (host WS)
│   │   ├── CustomerApi.ts          ← POST /api/sap/customer          (host WS)
│   │   └── RemissionApi.ts         ← POST /api/sap/remissionSap      (host SAP)
│   ├── schemas/
│   │   ├── sso.ts                  ← DTOs SSO
│   │   ├── logisticsCenter.ts      ← DTOs Centros Logísticos
│   │   ├── vendors.ts              ← DTOs Proveedores
│   │   ├── products.ts             ← DTOs Productos
│   │   ├── customer.ts             ← DTOs Clientes
│   │   └── remission.ts            ← DTOs Remisiones
│   ├── fixtures/
│   │   └── api.fixture.ts          ← Fixtures de Playwright con token SSO dinámico
│   └── utils/
│       ├── env.ts                  ← SAP_API_URL, WS_API_URL, SSO_URL, API_PUBLIC_KEY
│       ├── DataLoader.ts           ← Carga archivos JSON de data/
│       └── ResponseValidator.ts    ← Aserciones reutilizables
├── data/
│   ├── sso.json                    ← Payloads SSO (valid, emptyKey, invalidKey)
│   ├── logisticsCenter.json        ← Payloads Centros Logísticos
│   ├── vendors.json                ← Payloads Proveedores
│   ├── products.json               ← Payloads Productos
│   ├── customer.json               ← Payloads Clientes
│   └── remission.json              ← Payloads Remisiones
└── tests/
    └── {recurso}/                  ← Specs generados por el agente "Automatizar y Ejecutar"
```

**Aliases de importación** (declarados en `tsconfig.json`):
- `@apis/*` → `src/apis/*`
- `@schemas/*` → `src/schemas/*`
- `@fixtures/*` → `src/fixtures/*`
- `@utils/*` → `src/utils/*`
- `@data/*` → `data/*`

---

## Fixtures Disponibles (`api.fixture.ts`)

Todos los fixtures se importan desde `@fixtures/api.fixture` (nunca de `@playwright/test` directamente).

| Fixture | Descripción |
|---|---|
| `apiContext` | `APIRequestContext` sin autenticación — para casos negativos (401) |
| `ssoApi` | Instancia de `SsoApi` para llamar al endpoint de token directamente |
| `authenticatedContext` | `APIRequestContext` con token Bearer generado dinámicamente vía SSO (token nuevo por test) |
| `logisticsCenterApi` | `LogisticsCenterApi` con token — host SAP |
| `logisticsCenterApiNoAuth` | `LogisticsCenterApi` sin token — para casos 401 |
| `vendorsApi` | `VendorsApi` con token — host WS |
| `vendorsApiNoAuth` | `VendorsApi` sin token |
| `productsApi` | `ProductsApi` con token — host WS |
| `productsApiNoAuth` | `ProductsApi` sin token |
| `customerApi` | `CustomerApi` con token — host WS |
| `customerApiNoAuth` | `CustomerApi` sin token |
| `remissionApi` | `RemissionApi` con token — host SAP |
| `remissionApiNoAuth` | `RemissionApi` sin token |

> El token SSO se genera automáticamente en cada test que use un fixture autenticado. Dado que el token vence a ~30 segundos, el fixture garantiza un token fresco por cada resolución.

---

## Patrón de Test Obligatorio

```typescript
import { test, expect } from '@fixtures/api.fixture';
import { DataLoader } from '@utils/DataLoader';
import { ResponseValidator } from '@utils/ResponseValidator';
import type { CreateLogisticsCenterRequest } from '@schemas/logisticsCenter';

const data = DataLoader.load<{ valid: CreateLogisticsCenterRequest }>('logisticsCenter.json');

test.describe('POST /api/sap/logisticsCenter', () => {
  test('Crear centro logístico con datos válidos → HTTP 200', async ({ logisticsCenterApi }) => {
    const response = await logisticsCenterApi.create(data.valid);
    const body = await ResponseValidator.expectOk(response);
    expect(body.data.logistic_center).toBe(data.valid.logisticCenter);
  });

  test('Sin token Bearer → HTTP 401', async ({ logisticsCenterApiNoAuth }) => {
    const response = await logisticsCenterApiNoAuth.create(data.valid);
    await ResponseValidator.expectUnauthorized(response);
  });
});
```

---

## Reglas de Negocio Clave

- El token SSO vence a ~30 segundos: **nunca reutilizar entre tests** — el fixture `authenticatedContext` genera uno nuevo por test.
- Requests sin `Authorization` → HTTP 401.
- `public_key` vacía en SSO → HTTP 400 `INVALID_BODY_CONTENT`.
- `logisticCenter` es identificador único; no se puede modificar, salvo retoma MASSER → Franquicia.
- El campo `format` en Centros Logísticos es opcional; si se envía vacío puede provocar HTTP 400.
- `city` en Centros Logísticos determina el país y departamento asignados automáticamente por el sistema.
- Productos: endpoint es `/api/sap/product` (singular); no confundir con `products`.
- Vendors: endpoint incluye trailing slash `/api/sap/vendors/`.
- Todas las respuestas de error siguen la estructura: `{ status, code, message }`.

---

## Comandos de Ejecución (para el agente "Automatizar y Ejecutar")

> Los comandos se corren siempre desde la raíz del workspace.

### Suite API

| Propósito | Comando |
|---|---|
| **Verificar TypeScript** (antes de ejecutar) | `npx tsc --noEmit --project "automatizacion api/tsconfig.json"` |
| **Ejecutar toda la suite API** | `npm run test:api` |
| **Ejecutar un spec específico** | `npx playwright test "automatizacion api/tests/{recurso}/{spec}.spec.ts" --config "automatizacion api/playwright.config.ts"` |
| **Ejecutar por nombre** | `npm run test:api -- --grep "descripción"` |
| **Ver reporte HTML** | `npm run test:api:report` |
| **Leer resultados JSON** | `workspace__readFile` → `automatizacion api/reports/results.json` |

### Flujo obligatorio del agente para API

```
1. workspace__readFile(".github/context/contexto.md")                              ← bootstrap
2. workspace__readFile("archivos/Casos de Prueba/{ID}/{ID}-test-cases.json")       ← casos
3. workspace__listDirectory("automatizacion api/src/apis/")                        ← API objects
4. workspace__readFile("automatizacion api/src/schemas/{recurso}.ts")              ← tipos
5. workspace__readFile("automatizacion api/data/{recurso}.json")                   ← datos de prueba
6. workspace__writeFile("automatizacion api/tests/{recurso}/{recurso}.spec.ts", …) ← generar spec
7. workspace__executeCommand("npx tsc --noEmit --project \"automatizacion api/tsconfig.json\"")
8. workspace__executeCommand("npm run test:api")
9. workspace__readFile("automatizacion api/reports/results.json")                  ← leer resultados
10. Si hay fallos → corregir spec → volver al paso 7 (máx. 5 iteraciones)
```

### Interpretación de resultados JSON

```json
{
  "stats": { "expected": N, "unexpected": M, "flaky": 0 },
  "suites": [{ "specs": [{ "title": "...", "ok": true, "tests": [...] }] }]
}
```
- `stats.unexpected > 0` → hay fallos que corregir.
- `stats.expected === total` → todos pasaron → entrega completada.
- Detalle de fallos: `suites[*].specs[*].tests[*].errors[*].message`.

---

## Variables de Entorno Requeridas (definidas en `.env`)

| Variable | Descripción |
|---|---|
| `SAP_API_URL` | URL host SAP (ej. `https://serviciostg.terpelpos.com:7003`) |
| `WS_API_URL` | URL host WS (ej. `https://ws.fullcopy.terpel.sclbox.com:18001`) |
| `SSO_URL` | URL host SSO (ej. `https://serviciostg.terpelpos.com:7006`) |
| `API_PUBLIC_KEY` | Public key para generar tokens SSO — vigencia ~30s, regenerar por test |
| `AZURE_DEVOPS_ORG_URL` | URL de la organización Azure DevOps |
| `AZURE_DEVOPS_PROJECT` | Nombre del proyecto Azure DevOps |
| `AZURE_DEVOPS_PAT` | Token de acceso personal Azure DevOps |
| `AGENT_UI_PORT` | Puerto del servidor local Express (por defecto `3000`) |
