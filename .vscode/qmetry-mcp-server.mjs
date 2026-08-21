#!/usr/bin/env node
/**
 * Servidor MCP propio para QMetry Test Management for Jira (QTM4J).
 * No existe un servidor MCP oficial/comunitario para QMetry, así que este
 * lo implementa desde cero usando el SDK oficial de MCP, exponiendo tools
 * equivalentes a las que usan azure-devops/jira/playwright en este repo.
 *
 * Credenciales leídas de .env y usadas solo dentro de este proceso —
 * nunca se exponen al chat/agente.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Busca el .env desde el cwd (workspaceFolder) y como fallback desde __dirname
const candidatePaths = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, "..", ".env"),
];
const envPath = candidatePaths.find((p) => fs.existsSync(p));

const env = {};
if (envPath) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const clean = line.replace(/\r$/, "");
    const match = clean.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
}

if (!env.JIRA_URL) {
  process.stderr.write("ERROR: No se encontró JIRA_URL en el archivo .env\n");
  process.exit(1);
}

const BASE_URL = `${env.JIRA_URL.replace(/\/$/, "")}/rest/qtm4j/qapi/latest`;

function authHeaders() {
  if (!env.QMETRY_API_KEY) {
    throw new Error("QMETRY_API_KEY no está definido en .env (Jira > QMetry > Configuration > Open API > Generate)");
  }
  const headers = { apiKey: env.QMETRY_API_KEY, "Content-Type": "application/json" };
  if (env.JIRA_PERSONAL_TOKEN) {
    headers.Authorization = `Bearer ${env.JIRA_PERSONAL_TOKEN}`;
  } else if (env.JIRA_USERNAME && env.JIRA_API_TOKEN) {
    const b64 = Buffer.from(`${env.JIRA_USERNAME}:${env.JIRA_API_TOKEN}`).toString("base64");
    headers.Authorization = `Basic ${b64}`;
  } else {
    throw new Error("Define JIRA_PERSONAL_TOKEN o (JIRA_USERNAME + JIRA_API_TOKEN) en .env");
  }
  return headers;
}

async function qmetryFetch(pathSuffix, options = {}) {
  const res = await fetch(`${BASE_URL}${pathSuffix}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!res.ok) {
    const message = typeof data === "string" ? data : JSON.stringify(data);
    const err = new Error(`QMetry API ${res.status}: ${message}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function resolveProjectId(projectKey) {
  const data = await qmetryFetch("/projects");
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const project = list.find((p) => p.key === projectKey);
  if (!project) {
    throw new Error(`Proyecto "${projectKey}" no encontrado o sin QMetry habilitado. Proyectos disponibles: ${list.map((p) => p.key).join(", ")}`);
  }
  return project.id;
}

function textResult(payload) {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

function errorResult(err) {
  return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
}

const server = new McpServer({ name: "qmetry", version: "2.0.0" });

server.registerTool(
  "get_projects",
  {
    description: "Lista los proyectos de Jira con QMetry habilitado (id, key, name).",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      return textResult(await qmetryFetch("/projects"));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "create_testcase",
  {
    description: "Crea un Test Case en QMetry con todos sus campos: pasos, prioridad, tipo, estado, etiquetas, tiempo estimado, asignado y automatización.",
    inputSchema: z.object({
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado, ej. CORREOF"),
      summary: z.string().describe("Título del caso de prueba"),
      description: z.string().optional().describe("Descripción funcional del caso"),
      precondition: z.string().optional().describe("Precondiciones, texto libre"),
      steps: z
        .array(
          z.object({
            action: z.string().describe("Acción del paso"),
            data: z.string().optional().describe("Datos de prueba del paso"),
            expected_result: z.string().describe("Resultado esperado del paso"),
          }),
        )
        .default([])
        .describe("Pasos del caso de prueba en orden"),
      folder_id: z.number().optional().describe("ID de carpeta (ver get_folders/create_folder); omitir para carpeta raíz"),
      priority: z.string().optional().describe("Prioridad: 'Highest'|'High'|'Medium'|'Low'|'Lowest'"),
      labels: z.array(z.string()).optional().describe("Etiquetas de clasificación, ej. ['smoke','regresion']"),
      test_case_type: z.string().optional().describe("Tipo: 'Manual'|'Automated'|'Automated_Manual'"),
      status: z.string().optional().describe("Estado del caso, ej. 'Approved'|'Not_Approved'"),
      estimated_time_minutes: z.number().optional().describe("Tiempo estimado de ejecución en minutos"),
      automated: z.boolean().optional().describe("true si el caso está automatizado"),
      assignee: z.string().optional().describe("Username de Jira a quien se asigna el caso"),
    }),
  },
  async ({ project_key, summary, description, precondition, steps, folder_id, priority, labels, test_case_type, status, estimated_time_minutes, automated, assignee }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      const body = {
        projectId,
        summary,
        description: description || "",
        precondition: precondition || "",
        steps: (steps || []).map((s) => ({
          stepDetails: s.action,
          testData: s.data || "",
          expectedResult: s.expected_result,
        })),
      };
      if (folder_id !== undefined) body.folderId = folder_id;
      if (priority !== undefined) body.priority = priority;
      if (labels !== undefined) body.labels = labels;
      if (test_case_type !== undefined) body.testCaseType = test_case_type;
      if (status !== undefined) body.status = status;
      if (estimated_time_minutes !== undefined) body.estimatedTime = estimated_time_minutes * 60 * 1000;
      if (automated !== undefined) body.automated = automated;
      if (assignee !== undefined) body.assignee = assignee;
      return textResult(await qmetryFetch("/testcases", { method: "POST", body: JSON.stringify(body) }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "get_testcase",
  {
    description: "Obtiene el detalle de un Test Case de QMetry por clave/UID y número de versión (metadatos, no incluye pasos).",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case en QMetry, ej. TP-TC-17"),
      version_no: z.number().describe("Número de versión del test case"),
    }),
  },
  async ({ testcase_key, version_no }) => {
    try {
      return textResult(await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "update_testcase",
  {
    description: "Actualiza cualquier campo de un Test Case en QMetry: resumen, descripción, precondición, prioridad, etiquetas, tipo, estado, tiempo estimado, automatización y asignado. Para modificar pasos usa add_steps/update_step/delete_step.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case en QMetry"),
      version_no: z.number().describe("Número de versión del test case a actualizar"),
      summary: z.string().optional().describe("Nuevo título"),
      description: z.string().optional().describe("Nueva descripción funcional"),
      precondition: z.string().optional().describe("Nueva precondición"),
      priority: z.string().optional().describe("Prioridad: 'Highest'|'High'|'Medium'|'Low'|'Lowest'"),
      labels: z.array(z.string()).optional().describe("Nuevas etiquetas (reemplaza las actuales)"),
      test_case_type: z.string().optional().describe("Tipo: 'Manual'|'Automated'|'Automated_Manual'"),
      status: z.string().optional().describe("Nuevo estado, ej. 'Approved'|'Not_Approved'"),
      estimated_time_minutes: z.number().optional().describe("Tiempo estimado en minutos"),
      automated: z.boolean().optional().describe("true si el caso está automatizado"),
      assignee: z.string().optional().describe("Username de Jira del asignado"),
    }),
  },
  async ({ testcase_key, version_no, summary, description, precondition, priority, labels, test_case_type, status, estimated_time_minutes, automated, assignee }) => {
    try {
      const body = {};
      if (summary !== undefined) body.summary = summary;
      if (description !== undefined) body.description = description;
      if (precondition !== undefined) body.precondition = precondition;
      if (priority !== undefined) body.priority = priority;
      if (labels !== undefined) body.labels = labels;
      if (test_case_type !== undefined) body.testCaseType = test_case_type;
      if (status !== undefined) body.status = status;
      if (estimated_time_minutes !== undefined) body.estimatedTime = estimated_time_minutes * 60 * 1000;
      if (automated !== undefined) body.automated = automated;
      if (assignee !== undefined) body.assignee = assignee;
      await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return textResult({ updated: true, testcase_key, version_no });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "get_requirement_testcases",
  {
    description: "Lista los Test Cases de QMetry ya vinculados a un requerimiento (issue) de Jira — úsala antes de crear casos para evitar duplicados en re-ejecuciones.",
    inputSchema: z.object({
      jira_issue_id: z.number().describe("ID numérico del issue de Jira (requerimiento/HU), no la clave"),
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
    }),
  },
  async ({ jira_issue_id, project_key }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      return textResult(
        await qmetryFetch(`/requirements/${jira_issue_id}/testcases`, {
          method: "POST",
          body: JSON.stringify({ filter: { projectId } }),
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "get_folders",
  {
    description: "Lista las carpetas de Test Cases de un proyecto QMetry.",
    inputSchema: z.object({
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
    }),
  },
  async ({ project_key }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      return textResult(await qmetryFetch(`/projects/${projectId}/testcase-folders`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "create_folder",
  {
    description: "Crea una carpeta de Test Cases en un proyecto QMetry (útil para organizar casos por HU o módulo, como las Test Suites de Azure DevOps).",
    inputSchema: z.object({
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
      folder_name: z.string().describe("Nombre de la carpeta a crear"),
      parent_folder_id: z.number().optional().describe("ID de la carpeta padre; omite o usa -1 para carpeta raíz"),
      description: z.string().optional(),
    }),
  },
  async ({ project_key, folder_name, parent_folder_id, description }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      const folderId = await qmetryFetch(`/projects/${projectId}/testcase-folders`, {
        method: "POST",
        body: JSON.stringify({
          parentId: parent_folder_id ?? -1,
          folderName: folder_name,
          description: description || "",
        }),
      });
      return textResult({ folder_id: folderId, folder_name });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "create_testcycle",
  {
    description: "Crea un Test Cycle en QMetry — el contenedor de ejecución donde se corren y registran resultados de los Test Cases.",
    inputSchema: z.object({
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
      summary: z.string().describe("Nombre del test cycle, ej. 'Ejecución HU-1234 - Sprint 3'"),
      description: z.string().optional(),
    }),
  },
  async ({ project_key, summary, description }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      return textResult(
        await qmetryFetch("/testcycles", {
          method: "POST",
          body: JSON.stringify({ projectId, summary, description: description || "" }),
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "search_testcycles",
  {
    description: "Busca Test Cycles existentes en un proyecto QMetry por texto en el resumen — úsala antes de crear uno para evitar ciclos duplicados.",
    inputSchema: z.object({
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
      search_text: z.string().optional().describe("Texto a buscar en el summary del test cycle"),
    }),
  },
  async ({ project_key, search_text }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      const filter = { projectId };
      if (search_text) filter.searchText = search_text;
      return textResult(await qmetryFetch("/testcycles/search", { method: "POST", body: JSON.stringify({ filter }) }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "link_testcases_to_cycle",
  {
    description: "Vincula uno o más Test Cases (por UID y versión) a un Test Cycle para poder ejecutarlos.",
    inputSchema: z.object({
      testcycle_key: z.string().describe("Clave o UID del Test Cycle en QMetry"),
      testcases: z
        .array(
          z.object({
            testcase_uid: z.string().describe("UID del test case (campo 'id' devuelto por create_testcase, no la clave)"),
            version_no: z.number(),
          }),
        )
        .describe("Lista de test cases a vincular al ciclo"),
    }),
  },
  async ({ testcycle_key, testcases }) => {
    try {
      await qmetryFetch(`/testcycles/${encodeURIComponent(testcycle_key)}/testcases`, {
        method: "PUT",
        body: JSON.stringify({
          testCases: testcases.map((t) => ({ id: t.testcase_uid, versionNo: t.version_no })),
        }),
      });
      return textResult({ linked: true, testcycle_key, count: testcases.length });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "search_cycle_executions",
  {
    description: "Obtiene el resultado de ejecución (Pass/Fail/Blocked/No ejecutado) de los Test Cases vinculados a un Test Cycle — base para métricas de ejecución QA.",
    inputSchema: z.object({
      testcycle_key: z.string().describe("Clave o UID del Test Cycle en QMetry"),
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
    }),
  },
  async ({ testcycle_key, project_key }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      return textResult(
        await qmetryFetch(`/testcycles/${encodeURIComponent(testcycle_key)}/testcases/search`, {
          method: "POST",
          body: JSON.stringify({ filter: { projectId } }),
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "link_requirement",
  {
    description: "Vincula un Test Case de QMetry (clave y versión) a un requerimiento de Jira (ID numérico del issue, no la clave).",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave del test case en QMetry, ej. TP-TC-17"),
      version_no: z.number().describe("Número de versión del test case devuelto al crearlo"),
      jira_issue_id: z.number().describe("ID numérico del issue de Jira a vincular como requerimiento (no la clave)"),
    }),
  },
  async ({ testcase_key, version_no, jira_issue_id }) => {
    try {
      await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/version/${version_no}/requirements/link`, {
        method: "PUT",
        body: JSON.stringify({ requirementIds: [jira_issue_id] }),
      });
      return textResult({ linked: true, testcase_key, version_no, jira_issue_id });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "search_testcases",
  {
    description: "Busca Test Cases de QMetry con filtros avanzados: texto, carpeta, estado, prioridad, etiquetas y tipo.",
    inputSchema: z.object({
      project_key: z.string().describe("Clave del proyecto Jira con QMetry habilitado"),
      search_text: z.string().optional().describe("Texto a buscar en el summary"),
      folder_id: z.number().optional().describe("ID de carpeta para filtrar; omitir para buscar en todas"),
      status: z.string().optional().describe("Filtrar por estado, ej. 'Approved'|'Not_Approved'"),
      priority: z.string().optional().describe("Filtrar por prioridad, ej. 'High'|'Medium'|'Low'"),
      labels: z.array(z.string()).optional().describe("Filtrar por etiquetas"),
      test_case_type: z.string().optional().describe("Filtrar por tipo: 'Manual'|'Automated'"),
      max_results: z.number().optional().describe("Número máximo de resultados (default 50)"),
    }),
  },
  async ({ project_key, search_text, folder_id, status, priority, labels, test_case_type, max_results }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      const filter = { projectId };
      if (search_text) filter.searchText = search_text;
      if (folder_id !== undefined) filter.folderId = folder_id;
      if (status) filter.status = status;
      if (priority) filter.priority = priority;
      if (labels?.length) filter.labels = labels;
      if (test_case_type) filter.testCaseType = test_case_type;
      return textResult(
        await qmetryFetch("/testcases/search", {
          method: "POST",
          body: JSON.stringify({ filter, maxResults: max_results ?? 50 }),
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ── Ciclo de vida del Test Case ───────────────────────────────────────────────

server.registerTool(
  "get_testcase_versions",
  {
    description: "Lista todas las versiones de un Test Case en QMetry con su número de versión y estado.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case en QMetry, ej. TP-TC-17"),
    }),
  },
  async ({ testcase_key }) => {
    try {
      return textResult(await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/versions`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "delete_testcase",
  {
    description: "Elimina permanentemente un Test Case de QMetry. Esta acción no se puede deshacer.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case a eliminar"),
    }),
  },
  async ({ testcase_key }) => {
    try {
      await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}`, { method: "DELETE" });
      return textResult({ deleted: true, testcase_key });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "clone_testcase",
  {
    description: "Clona un Test Case existente en QMetry, opcionalmente en un proyecto o carpeta destino distintos.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case a clonar"),
      project_key: z.string().describe("Clave del proyecto destino (puede ser el mismo)"),
      folder_id: z.number().optional().describe("ID de carpeta destino; omitir para carpeta raíz"),
    }),
  },
  async ({ testcase_key, project_key, folder_id }) => {
    try {
      const projectId = await resolveProjectId(project_key);
      const body = { projectId };
      if (folder_id !== undefined) body.folderId = folder_id;
      return textResult(
        await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/clone`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "move_testcase",
  {
    description: "Mueve un Test Case a otra carpeta dentro del mismo proyecto QMetry.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case a mover"),
      version_no: z.number().describe("Número de versión del test case"),
      folder_id: z.number().describe("ID de la carpeta destino (ver get_folders)"),
    }),
  },
  async ({ testcase_key, version_no, folder_id }) => {
    try {
      await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}`, {
        method: "PUT",
        body: JSON.stringify({ folderId: folder_id }),
      });
      return textResult({ moved: true, testcase_key, folder_id });
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ── Pasos (Steps) ─────────────────────────────────────────────────────────────

server.registerTool(
  "get_testcase_steps",
  {
    description: "Obtiene todos los pasos de un Test Case de QMetry, incluyendo sus IDs (necesarios para update_step y delete_step).",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case"),
      version_no: z.number().describe("Número de versión del test case"),
    }),
  },
  async ({ testcase_key, version_no }) => {
    try {
      return textResult(
        await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}/steps`),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "add_steps",
  {
    description: "Agrega pasos al final de un Test Case ya existente en QMetry.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case"),
      version_no: z.number().describe("Número de versión del test case"),
      steps: z
        .array(
          z.object({
            action: z.string().describe("Acción del paso"),
            data: z.string().optional().describe("Datos de prueba del paso"),
            expected_result: z.string().describe("Resultado esperado del paso"),
          }),
        )
        .min(1)
        .describe("Lista de pasos a agregar"),
    }),
  },
  async ({ testcase_key, version_no, steps }) => {
    try {
      return textResult(
        await qmetryFetch(`/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}/steps`, {
          method: "POST",
          body: JSON.stringify(
            steps.map((s) => ({
              stepDetails: s.action,
              testData: s.data || "",
              expectedResult: s.expected_result,
            })),
          ),
        }),
      );
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "update_step",
  {
    description: "Actualiza un paso específico de un Test Case en QMetry. El step_id se obtiene con get_testcase_steps.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case"),
      version_no: z.number().describe("Número de versión del test case"),
      step_id: z.number().describe("ID numérico del paso (obtenido con get_testcase_steps)"),
      action: z.string().optional().describe("Nueva acción del paso"),
      data: z.string().optional().describe("Nuevos datos de prueba"),
      expected_result: z.string().optional().describe("Nuevo resultado esperado"),
    }),
  },
  async ({ testcase_key, version_no, step_id, action, data, expected_result }) => {
    try {
      const body = {};
      if (action !== undefined) body.stepDetails = action;
      if (data !== undefined) body.testData = data;
      if (expected_result !== undefined) body.expectedResult = expected_result;
      await qmetryFetch(
        `/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}/steps/${step_id}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      return textResult({ updated: true, testcase_key, version_no, step_id });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "delete_step",
  {
    description: "Elimina un paso específico de un Test Case en QMetry. El step_id se obtiene con get_testcase_steps.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave o UID del test case"),
      version_no: z.number().describe("Número de versión del test case"),
      step_id: z.number().describe("ID numérico del paso a eliminar"),
    }),
  },
  async ({ testcase_key, version_no, step_id }) => {
    try {
      await qmetryFetch(
        `/testcases/${encodeURIComponent(testcase_key)}/versions/${version_no}/steps/${step_id}`,
        { method: "DELETE" },
      );
      return textResult({ deleted: true, testcase_key, version_no, step_id });
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ── Requerimientos ────────────────────────────────────────────────────────────

server.registerTool(
  "unlink_requirement",
  {
    description: "Desvincula un requerimiento (issue de Jira) de un Test Case en QMetry.",
    inputSchema: z.object({
      testcase_key: z.string().describe("Clave del test case en QMetry"),
      version_no: z.number().describe("Número de versión del test case"),
      jira_issue_id: z.number().describe("ID numérico del issue de Jira a desvincular"),
    }),
  },
  async ({ testcase_key, version_no, jira_issue_id }) => {
    try {
      await qmetryFetch(
        `/testcases/${encodeURIComponent(testcase_key)}/version/${version_no}/requirements/unlink`,
        { method: "PUT", body: JSON.stringify({ requirementIds: [jira_issue_id] }) },
      );
      return textResult({ unlinked: true, testcase_key, version_no, jira_issue_id });
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ── Test Cycles — gestión y ejecución ─────────────────────────────────────────

server.registerTool(
  "update_testcycle",
  {
    description: "Actualiza el resumen, descripción o fechas de un Test Cycle existente en QMetry.",
    inputSchema: z.object({
      testcycle_key: z.string().describe("Clave o UID del Test Cycle en QMetry"),
      summary: z.string().optional().describe("Nuevo nombre del ciclo"),
      description: z.string().optional().describe("Nueva descripción"),
      start_date: z.string().optional().describe("Fecha de inicio real, formato YYYY-MM-DD"),
      end_date: z.string().optional().describe("Fecha de fin real, formato YYYY-MM-DD"),
      planned_start_date: z.string().optional().describe("Fecha de inicio planificada, formato YYYY-MM-DD"),
      planned_end_date: z.string().optional().describe("Fecha de fin planificada, formato YYYY-MM-DD"),
    }),
  },
  async ({ testcycle_key, summary, description, start_date, end_date, planned_start_date, planned_end_date }) => {
    try {
      const body = {};
      if (summary !== undefined) body.summary = summary;
      if (description !== undefined) body.description = description;
      if (start_date !== undefined) body.startDate = start_date;
      if (end_date !== undefined) body.endDate = end_date;
      if (planned_start_date !== undefined) body.plannedStartDate = planned_start_date;
      if (planned_end_date !== undefined) body.plannedEndDate = planned_end_date;
      await qmetryFetch(`/testcycles/${encodeURIComponent(testcycle_key)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return textResult({ updated: true, testcycle_key });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "unlink_testcases_from_cycle",
  {
    description: "Desvincula uno o más Test Cases de un Test Cycle en QMetry.",
    inputSchema: z.object({
      testcycle_key: z.string().describe("Clave o UID del Test Cycle"),
      testcases: z
        .array(
          z.object({
            testcase_uid: z.string().describe("UID del test case"),
            version_no: z.number(),
          }),
        )
        .describe("Lista de test cases a desvincular del ciclo"),
    }),
  },
  async ({ testcycle_key, testcases }) => {
    try {
      await qmetryFetch(`/testcycles/${encodeURIComponent(testcycle_key)}/testcases`, {
        method: "DELETE",
        body: JSON.stringify({
          testCases: testcases.map((t) => ({ id: t.testcase_uid, versionNo: t.version_no })),
        }),
      });
      return textResult({ unlinked: true, testcycle_key, count: testcases.length });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "update_execution",
  {
    description: "Actualiza el resultado de ejecución (Pass/Fail/Blocked) de un Test Case dentro de un Test Cycle. El execution_id se obtiene con search_cycle_executions.",
    inputSchema: z.object({
      testcycle_key: z.string().describe("Clave o UID del Test Cycle"),
      testcase_key: z.string().describe("Clave del Test Case ejecutado"),
      execution_id: z.number().describe("ID numérico de la ejecución (campo 'id' de search_cycle_executions)"),
      status: z.string().describe("Resultado: 'Pass'|'Fail'|'Blocked'|'Not Executed'|'In Progress'"),
      comment: z.string().optional().describe("Comentario o evidencia del resultado"),
    }),
  },
  async ({ testcycle_key, testcase_key, execution_id, status, comment }) => {
    try {
      const body = { status };
      if (comment !== undefined) body.comment = comment;
      await qmetryFetch(
        `/testcycles/${encodeURIComponent(testcycle_key)}/testcases/${encodeURIComponent(testcase_key)}/executions/${execution_id}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      return textResult({ updated: true, testcycle_key, testcase_key, execution_id, status });
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("QMetry MCP Server corriendo en stdio");
