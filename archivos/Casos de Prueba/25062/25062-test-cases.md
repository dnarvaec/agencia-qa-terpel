# Casos de Prueba — HU-25062: SAP - Servicio creación de EDS que envia SAP

**Fecha de generación:** 2024-06-18T21:25:00Z

## Entorno
| Web |
| --- |
| N/A (solo API, ver API_URL en contexto) |

## Credenciales
| Usuario | Rol | Contraseña |
|---------|-----|------------|
| N/A | (ver .env) | (ver .env) |

## Resumen
| Total Web | Total API | Total Manual | Total |
|-----------|-----------|--------------|-------|
| 0 | 8 | 1 | 9 |

## Casos de Prueba

---

### Creación exitosa de EDS recibida de SAP (todas las reglas de integración y asignación automática)

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros (integración SAP-HO) | La EDS ingresada mediante API debe reflejar los datos con asignación automática según las reglas del negocio y retornar la estructura de respuesta exitosa estándar. |

**Descripción:**
Validar que al recibir una EDS desde SAP vía API POST /api/sap/logisticsCenter, se integra en el sistema, se asignan país y departamento automáticamente según ciudad, y se crean los registros faltantes (dirección, correo, teléfono) vacíos, permitiendo su actualización posterior.

**Precondiciones:**
- Contar con credenciales API válidas y acceso autorizado (Token SSO con API_PUBLIC_KEY, API_URL consultable)
- Disponibilidad de los datos mínimos requeridos provenientes de SAP para la creación de una EDS

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Generar token SSO con API_PUBLIC_KEY por POST a {SSO_URL}/api/v1/authentication/generate-token | Body: {"public_key": "<valor API_PUBLIC_KEY>"} | Se recibe token válido (status=200, tiene campo token). |
| 2 | Consumir endpoint POST /api/sap/logisticsCenter con datos proporcionados por SAP en el body y el Bearer token en Authorization. | Body: logisticCenter, logisticName, logisticCenterType, regional, companyCode, customer, cashBook, costCenter, profitCenter, city, edscod, format, status, modificationDate, modificationHour (según estructura) | Respuesta status 200 y objeto data con empresaId numérico y el código del centro logístico; país y departamento asignados según ciudad; dirección, correo y teléfono vacíos. |
| 3 | Consultar la persistencia de la EDS creada a través del mismo endpoint o consulta secundaria | Consulta por el código SAP (logisticCenter) de la EDS | La EDS creada está registrada con país y departamento asociados y los campos (dirección, correo, teléfono) en blanco/listos para completar. |

**Post-condición:**
La EDS queda persistida en el sistema HO con los campos integrados según reglas de negocio.

---

### Creación de EDS con campo obligatorio vacío (caso campo format vacío)

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | El endpoint debe validar que ningún campo obligatorio esté vacío y responder con el error correspondiente. |

**Descripción:**
Validar que el API rechaza la creación de una EDS cuando un campo obligatorio (ejemplo: format) se encuentra vacío, retornando un error HTTP 400 y estructura de error.

**Precondiciones:**
- Token de autenticación SSO válido
- Preparar payload con algún campo obligatorio vacío (format='')

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Generar token SSO válido | Body: {"public_key": "<API_PUBLIC_KEY>"} | Token recibido (200). |
| 2 | Intentar POST /api/sap/logisticsCenter enviando algún campo obligatorio vacío (ej: format=''), incluye el token en Authorization. | Body con todos los campos, pero format='' | Respuesta status 400 y estructura: { code: 'INVALID_BODY_CONTENT', message: [...], status: 400 } |

**Post-condición:**
La EDS no es creada ni persistida por regla de negocio.

---

### Intento de creación EDS sin token de autenticación (401)

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | El endpoint debe rechazar las peticiones no autenticadas devolviendo HTTP 401 y estructura de error AUTHENTICATION_ERROR. |

**Descripción:**
Verificar que no es posible crear una EDS en el sistema si no se proporciona el token Bearer en Authorization.

**Precondiciones:**
- Preparar payload válido para POST /api/sap/logisticsCenter, pero no incluir cabecera Authorization.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Consumir el endpoint /api/sap/logisticsCenter sin token Bearer | Payload válido, sin cabecera Authorization | Respuesta HTTP 401 con cuerpo: { tipoError: 'NOT_PAUTHORIZED', code: 'AUTHENTICATION_ERROR', message: 'DOES NOT HAVE PERMISSIONS', status: 401 } |

**Post-condición:**
No se crea ninguna EDS, petición rechazada por autenticación.

---

### Validación campo logisticCenterType — solo valores permitidos

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | El API solo debe aceptar logisitcCenterType conforme a catálogo permitido; otros valores generan respuesta HTTP 400. |

**Descripción:**
Verificar que el campo logisticCenterType solo admite los valores permitidos (DEUNA, EDS, KCO, TDC), rechazando cualquier otro valor.

**Precondiciones:**
- Token Bearer SSO válido
- Payload para POST /api/sap/logisticsCenter con campo logisticCenterType fuera del catálogo

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Generar token válido | Body: {"public_key": "<API_PUBLIC_KEY>"} | Token recibido (200) |
| 2 | POST /api/sap/logisticsCenter con logisticCenterType='INVALID_TYPE' | Payload válido salvo campo logisitcCenterType | Response código 400, code: 'INVALID_BODY_CONTENT' y mensaje sobre valor inválido de logisticCenterType |

**Post-condición:**
Petición rechazada, EDS no creada si campo fuera de catálogo.

---

### Consulta de EDS integradas vía endpoint de consulta

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | Demostrar que una EDS creada puede ser recuperada y todos sus datos importantes pueden visualizarse tras la integración. |

**Descripción:**
Validar que sea posible consultar las EDS integradas (creadas) por SAP mediante el endpoint de consulta correspondiente según código logístico.

**Precondiciones:**
- EDS previamente creada e integrada vía POST /api/sap/logisticsCenter
- Credenciales y token válidos de acceso API

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token SSO válido | public_key (contexto) | Token (200) recibido |
| 2 | Invocar endpoint de consulta EDS con el código creado | GET /api/sap/logisticsCenter?logisticCenter=XXXX | Respuesta HTTP 200, estructura JSON con datos exactos de la EDS integrada |

**Post-condición:**
La información de la EDS puede verificarse consistentemente mediante consulta API.

---

### Edición de EDS integrada: todos los campos excepto centro logístico (regla), centro logístico solo retoma

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | La edición debe cumplir la restricción de bloqueo sobre centro logístico salvo excepción (retoma de MASSER a Franquicia) |

**Descripción:**
Validar que es posible modificar cualquier campo de una EDS integrada desde SAP excepto el centro logístico, el cual solo puede modificarse en casos de retoma entre compañías.

**Precondiciones:**
- EDS previamente creada vía API
- Token y credenciales API válidas

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token SSO válido | public_key API_PUBLIC_KEY | Token emitido OK (200) |
| 2 | Invocar endpoint de modificación EDS (ejemplo: PATCH /api/sap/logisticsCenter/{logisticCenter}) solo modificando campos distintos del centro logístico | Body con campos modificados | La EDS actualiza todos los campos distintos de centro logístico y retorna status 200 |
| 3 | Intentar modificar centro logístico salvo caso retoma (de MASSER a Franquicia) | PATCH con centro logístico distinto | Solo permite modificación si corresponde a caso retoma; si no, rechaza modificación (HTTP 400/403) |

**Post-condición:**
Solo los campos permitidos pueden ser modificados; centro logístico salvo excepciones.

---

### Creación/edición EDS afiliada directamente

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | Asegurar que las funcionalidades anteriores de afiliadas se mantienen a pesar de la integración nueva. |

**Descripción:**
Verificar que sigue disponible la funcionalidad de creación de EDS para estaciones afiliadas directamente en el HO, usando el endpoint habitual.

**Precondiciones:**
- Credenciales y token API válidos
- Payload válido para creación de EDS afiliada

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Generar token SSO válido API_PUBLIC_KEY | POST generate-token | Token 200 recibido |
| 2 | Consumir POST /api/sap/logisticsCenter con campo format='Afiliada' y resto según reglas | Body completo, campo format=Afiliada | Respuesta HTTP 200 exitosa; EDS afiliada creada como antes. |

**Post-condición:**
La creación de EDS afiliada sigue funcional sin afectación por nueva integración SAP-HO.

---

### Asociación correcta de regional en reportería

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Responsable de datos maestros | Asegurar la asociación visible de regional en los reportes y consultas del sistema. |

**Descripción:**
Verificar que, al crear o consultar una EDS, la regional asignada aparece y es trazable en reportería (campo regional).

**Precondiciones:**
- EDS creada e integrada correctamente
- Acceso al endpoint de reportería/consulta

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener EDS creada por código logístico usando consulta/reportería | Código EDS registrado | En response JSON, campo regional está asociado y es visible para la EDS correspondiente. |

**Post-condición:**
La EDS relacionada siempre refleja la regional asociada en reportes y consultas.

---

### Creación de cola en datalake MDM al crear EDS

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | Administrador de MDM SAP / Operaciones | Trazabilidad de la EDS mediante la cola generada en el datalake, validación en sistemas externos. |

**Descripción:**
Verificar que con cada EDS creada se genera la cola correspondiente en el datalake de MDM, asegurando la trazabilidad corporativa fuera del sistema bajo prueba.

**Precondiciones:**
- Una EDS fue creada correctamente mediante la API o flujo de integración SAP-HO
- Acceso a logs del datalake de MDM o herramienta equivalente

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Acceder al datalake de MDM con usuario administrativo autorizado | Usuario MDM/logs | Acceso garantizado a logs y colas creadas. |
| 2 | Buscar la cola generada para la EDS, asociada al código logístico (ID EDS) | Código logístico/metadata de EDS | Existe registro en datalake de la cola MDM para la EDS recién creada, con trazabilidad/fecha/hora. |

**Post-condición:**
La EDS tiene vinculo/trazabilidad en la infraestructura de MDM externo.

