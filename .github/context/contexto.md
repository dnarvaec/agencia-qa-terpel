# Contexto del Proyecto

> Este archivo contiene toda la información específica del cliente y la aplicación bajo prueba.
> **Para migrar la agencia a un nuevo cliente**, modifica únicamente este archivo.
> Los 4 agentes leen este archivo en bootstrap para obtener el contexto necesario.

---

## Proyecto

| Campo | Valor |
|---|---|
| **Nombre del proyecto** | POC Terpel |

---

## Aplicación Bajo Prueba (AUT)

| Entorno | URL |
|---|---|
| **Web** | N/A |
| **API** | _No configurada — definir en `.env` como `API_URL`_ |

### Módulos de la Aplicación

---

## Credenciales de Prueba

---

## Comportamientos Conocidos de la Aplicación

---

## Selectores Estables Conocidos

---

## Variables de Entorno Requeridas (Definidas en .env)

| Variable | Descripción |
|---|---|---|
| `AZURE_DEVOPS_ORG_URL` | URL de la organización |
| `AZURE_DEVOPS_PROJECT` | Nombre del proyecto |
| `AZURE_DEVOPS_PAT` | Token de acceso personal |
| `APP_URL` | URL base de la aplicación web |
| `API_URL` | URL base de la api |
| `AGENT_UI_PORT` | Puerto del servidor local Express (3000) |
