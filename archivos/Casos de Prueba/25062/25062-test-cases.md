# Casos de Prueba — HU-25062: SAP - Servicio creación de EDS que envia SAP

**Fecha de generación:** 2024-06-28T00:00:00Z

## Entorno
| Web | Api |
| --- | --- |
| N/A (alcance sólo API) | [object Object] |

## Credenciales
| Usuario | Rol | Contraseña |
|---------|-----|------------|
| <API_PUBLIC_KEY> | api_consumer | <definido en .env> |

## Resumen
| Total Web | Total API | Total Manual | Total |
|-----------|-----------|--------------|-------|
| 0 | 10 | 2 | 12 |

## Casos de Prueba

---

### Creación exitosa de EDS con todos los campos requeridos (vía SAP)

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Confirmar que la EDS se crea correctamente y el código SAP es reflejado en la respuesta. |

**Descripción:**
Se valida la creación de una nueva EDS integrando todos los campos requeridos desde SAP. El sistema debe almacenar los datos y reflejar el código único proveniente de SAP.

**Precondiciones:**
- Contar con API_PUBLIC_KEY válido configurado en el .env.
- Autenticarse correctamente para obtener token SSO válido.
- El código de centro logístico no existe previamente en el sistema.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token SSO vía POST /api/v1/authentication/generate-token | Headers: application/json, Body: { public_key: <API_PUBLIC_KEY> } | HTTP 200 con campo 'token' válido en la respuesta |
| 2 | Consumir endpoint POST /api/sap/logisticsCenter | Headers: Authorization: Bearer <token>, Body: payload válido con todos los campos obligatorios | HTTP 200. En el body, el campo 'data.logistic_center' es igual al enviado y el status es 200. |

**Post-condición:**
La EDS está registrada en el sistema con todos sus datos, el código es visible y único.

---

### Asignación automática de país y departamento por ciudad

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Garantizar que país y departamento se obtienen en base a la ciudad informada y se almacenan correctamente. |

**Descripción:**
Valida que al enviar únicamente ciudad, el sistema asigna automáticamente país y departamento en el registro de EDS.

**Precondiciones:**
- Contar con un token SSO válido.
- Payload de creación de EDS solo incluye la ciudad (sin país ni departamento).

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token SSO restante si es necesario. | Ver fixture de autenticación API | Token válido obtenido |
| 2 | Consumir POST /api/sap/logisticsCenter con sólo ciudad informada (sin país/departamento) | Body como en ejemplo válido de data/logisticsCenter.json | HTTP 200. En la base de datos, país y departamento asignados de acuerdo a la ciudad enviada. |

**Post-condición:**
El registro de la EDS contiene país y departamento asignados automáticamente conforme a la ciudad.

---

### Campos dirección, correo y teléfono pueden quedar vacíos si SAP no los envía

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Confirmar que la creación de EDS funciona dejando estos campos vacíos y que luego pueden actualizarse manualmente. |

**Descripción:**
Se prueba que la omisión de los campos dirección, correo o teléfono en el payload no impide la creación de la EDS.

**Precondiciones:**
- Token SSO válido obtenido.
- Payload sin los campos dirección/correo/teléfono.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token SSO. | SSO flow. | Token válido. |
| 2 | Consumir POST /api/sap/logisticsCenter sin los campos dirección, correo, teléfono. | Payload omitido (ver esquema logisticsCenter) | HTTP 200, la EDS es creada sin esos campos poblados. Luego pueden setearse manualmente por otro flujo fuera de este endpoint. |

**Post-condición:**
EDS creada exitosamente, dirección, correo y teléfono pueden ser completados después en interfaz manual.

---

### Validación de obligatoriedad de los campos requeridos

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Comprobar robustez en el backend ante la omisión de campos requeridos. |

**Descripción:**
Se valida que se obtenga HTTP 400 cuando falta algún campo obligatorio en el payload.

**Precondiciones:**
- Token SSO válido disponible.
- Payload incompleto (ver data/logisticsCenter.json > missingFields)

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token válido si es requerido. | SSO | Token válido |
| 2 | POST /api/sap/logisticsCenter con campos omitidos. | Payload: missingFields | HTTP 400 con code INVALID_BODY_CONTENT y message con nombres de campos requeridos faltantes. |

**Post-condición:**
La EDS no es creada en el sistema.

---

### Intento de creación de EDS sin autenticación (sin token) — retorna 401

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Validar seguridad por autenticación obligada. |

**Descripción:**
Se verifica que el endpoint rechaza intentos de creación sin token Bearer.

**Precondiciones:**
- No enviar header Authorization.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Consumir API POST /api/sap/logisticsCenter sin header Authorization. | Payload válido pero sin token. | HTTP 401 y mensaje de AUTHENTICATION_ERROR en el body (estructura definida en contexto.md) |

**Post-condición:**
La EDS no es creada y la respuesta señala falta de permisos.

---

### Creación de EDS con campo 'format' vacío — valida error de negocio

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Comprobar que la API no acepta strings vacíos para campos opcionales cuando la validación sí aplica. |

**Descripción:**
Verifica rechazo (400) si se envía el campo format explícitamente vacío, aun siendo opcional.

**Precondiciones:**
- Token válido.
- Payload incluye field format: '' (ver data.logisticsCenter.json > emptyFormat)

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token válido. | SSO | Token válido. |
| 2 | POST /api/sap/logisticsCenter con format vacío (''). | Payload: emptyFormat | HTTP 400 con code INVALID_BODY_CONTENT. |

**Post-condición:**
No se crea la EDS cuando format=''.

---

### Intento de creación con código de EDS (logisticCenter) ya existente — valida unicidad

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Asegurar integridad referencial por código único asignado por SAP. |

**Descripción:**
Se valida que no es posible crear dos EDS con el mismo código logisticCenter.

**Precondiciones:**
- EDS con el código logisticCenter existe previamente.
- Payload válido pero con código duplicado.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Obtener token válido. | SSO | Token válido. |
| 2 | POST /api/sap/logisticsCenter con código ya existente. | Payload: igual a la EDS ya existente. | HTTP 400 (o mensaje de error específico de unicidad según backend). |

**Post-condición:**
No se permite duplicidad de EDS, integridad garantizada por código.

---

### Creación de cola en datalake MDM para la EDS creada

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Asegurar cumplimiento de trazabilidad de EDS creadas desde SAP. |

**Descripción:**
Verifica que tras la creación exitosa de EDS, se genera un registro/cola de trazabilidad en el datalake.

**Precondiciones:**
- EDS creada exitosamente por SAP (ver TC-001).

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Crear EDS por API según TC-001 (precondición, mock o llamada real). | Payload válido. | HTTP 200, EDS creada. |
| 2 | Verificar en el datalake MDM existencia de cola para la EDS creada. | Consultar sistema externo o mock. | Existe registro de trazabilidad en MDM para la EDS nueva. |

**Post-condición:**
Cola MDM actualizada con nueva EDS.

---

### Contrato técnico del servicio es respetado en errores y respuestas

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Asegurar estandarización en la interfaz y facilidad de integración. |

**Descripción:**
Valida que todas las respuestas (éxito y error) siguen la estructura JSON de contrato.

**Precondiciones:**
- Preparar varios escenarios (creación válida, error 400 y error 401).

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Ejecutar POST válido (como en TC-001). | Payload válido | Estructura: { message, status, data: {empresaId, logistic_center} } |
| 2 | Ejecutar POST con campos faltantes. | Payload inválido | Estructura: { code, message[], status } y status=400 |
| 3 | Ejecutar POST sin header Authorization. | Payload válido sin token | Estructura: { tipoError, code, message, status } y status=401 |

**Post-condición:**
Todos los flujos cumplen contrato técnico (esquema estándar).

---

### Creación manual de EDS debe mantenerse para afiliadas (NO SAP)

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | api_consumer | Evitar regresión en la funcionalidad de creación manual de EDS. |

**Descripción:**
Confirma que el endpoint de creación manual de EDS por fuera de SAP sigue activo y funcional.

**Precondiciones:**
- Existencia funcional del endpoint/manual de creación de EDS para afiliadas.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Consumir endpoint/manual para crear EDS afiliada (no SAP). | Payload de EDS afiliada. | EDS afiliada creada exitosamente. |

**Post-condición:**
EDS afiliadas pueden seguir creándose sin emplear SAP.

---

### Consulta de EDS integradas desde SAP en la gestión/configuración web

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | rol_usuario_gestor | Asegurar que la consulta/proyección UI de EDS SAP sea completa y veraz. |

**Descripción:**
El usuario debe poder visualizar y consultar todas las EDS integradas desde SAP en la gestión desde la interfaz web.

**Precondiciones:**
- Usuario autenticado en HO con permisos de gestión de EDS.
- EDS ya creadas desde SAP.
- Acceso a la interfaz de gestión de EDS.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Navegar y autenticar usuario en web de HO. | Usuario y contraseña HO. | Usuario autenticado y acceso a menú de gestión. |
| 2 | Acceder a gestión/configuración de EDS. | Menú correspondiente. | Listado de EDS integradas desde SAP visible. |

**Post-condición:**
EDS SAP visibles en la interfaz y consultables.

---

### Modificación de campos de EDS traída de SAP desde la interfaz (edición y restricciones)

| Tipo | Prioridad | Rol | Objetivo |
|------|-----------|-----|---------|
| api | alta | rol_usuario_gestor | Comprobar reglas de edición según origen y condición retoma. |

**Descripción:**
Verifica que los campos de EDS proveniente de SAP pueden editarse salvo centro logístico (a excepción de retomas), y la regional puede modificarse.

**Precondiciones:**
- Acceso a la interfaz de gestión/configuración de EDS como usuario con permisos de edición.
- EDS SAP ya integrada.

**Pasos:**
| # | Acción | Datos de prueba | Resultado Esperado |
|---|--------|----------------|-------------------|
| 1 | Autenticarse en la plataforma web de HO. | Usuario y clave. | Ingreso a la pantalla principal. |
| 2 | Seleccionar EDS proveniente de SAP para edición. | Buscar y seleccionar EDS de la lista. | Ficha de edición visible con campos editables y no editables según regla. |
| 3 | Confirmar que sólo los campos permitidos pueden ser modificados y la regional es editable. | Intentar modificar cada campo. | Centro logístico solo editable si EDS fue retomada (MASSER a franquicia). Regional editable siempre. |

**Post-condición:**
Sólo las reglas descritas de edición se cumplen por la UI.

