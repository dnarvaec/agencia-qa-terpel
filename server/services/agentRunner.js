'use strict';

/**
 * agentRunner — bucle principal de ejecución de agentes.
 *
 * Flujo:
 *  1. Carga el agente desde .github/agents/
 *  2. Arranca los servidores MCP necesarios
 *  3. Construye la lista de herramientas para Azure OpenAI
 *  4. Ejecuta el loop conversacional (LLM → tool_calls → LLM → …)
 *  5. Emite eventos de progreso en tiempo real vía onProgress()
 */

const { AzureOpenAI } = require('openai');

const { getAgent, getSkills } = require('./agentReader');
const MCPManager = require('./mcpManager');
const { WORKSPACE_TOOL_DEFS,
  callWorkspaceTool } = require('./workspaceTools');

const MAX_ITERATIONS = 70;

/**
 * Máximo de caracteres del resultado de una herramienta MCP que se envían
 * como contexto al LLM. Reduce el riesgo de context-overflow con respuestas
 * verbosas de Azure DevOps (HTML, metadatos, links, etc.).
 * El display en consola usa un límite más corto (500 chars).
 */
const MAX_TOOL_RESULT_LLM_CHARS = 300000;

// Constantes estáticas a nivel módulo — evitan reconstrucción en cada llamada a runAgent
const AZDEVOPS_SUBCATEGORY_KEYWORDS = {
  wit:       ['work item', 'historia', 'user story', 'backlog', 'historias de usuario', 'hu '],
  testplan:  ['test plan', 'test case', 'caso de prueba', 'casos de prueba', 'plan de prueba', 'test suite'],
  repo:      ['repositori', 'branch', 'pull request', 'commit', 'código fuente', 'rama'],
  pipelines: ['pipeline', 'build', 'ci/cd', 'deployment', 'compilación'],
  wiki:      ['wiki'],
  work:      ['iteration', 'sprint', 'capacidad del equipo', 'team capacity'],
  search:    ['search_code', 'search_wiki', 'search_workitem', 'buscar en wiki'],
  core:      ['listar proyectos', 'core_list', 'core_get'],
  advsec:    ['advsec', 'security alert', 'vulnerabilidad'],
};

const TOOL_NAME_MAP = [
  [/\bedit\/createFile\b/g,                 'workspace__writeFile'],
  [/\bedit\/editFiles\b/g,                  'workspace__writeFile'],
  [/\bedit\/createDirectory\b/g,            'workspace__createDirectory'],
  [/\bedit\/rename\b/g,                     'workspace__renameFile'],
  [/\bread\/readFile\b/g,                   'workspace__readFile'],
  [/\bread\/getFile\b/g,                    'workspace__readFile'],
  [/\bsearch\/listDirectory\b/g,            'workspace__listDirectory'],
  [/\bsearch\/fileSearch\b/g,               'workspace__fileSearch'],
  [/\bsearch\/textSearch\b/g,               'workspace__textSearch'],
  [/\bsearch\/codebase\b/g,                 'workspace__textSearch'],
  [/\bweb\/fetch\b/g,                       'workspace__fetchUrl'],
  [/\bread\/viewImage\b/g,                  '(no disponible en este runtime)'],
  [/\bread\/problems\b/g,                   '(no disponible en este runtime)'],
  [/\bread\/readNotebookCellOutput\b/g,      '(no disponible en este runtime)'],
  [/\bread\/getNotebookSummary\b/g,          '(no disponible en este runtime)'],
  [/\bedit\/createJupyterNotebook\b/g,      '(no disponible en este runtime)'],
  [/\bedit\/editNotebook\b/g,               '(no disponible en este runtime)'],
  [/\bsearch\/usages\b/g,                   '(no disponible en este runtime)'],
];

const COMPLEX_FILTER_SERVERS = new Set(['azure-devops']);

const PREFIX_MAP = {
  start:        '[AGENTE]  ',
  info:         '[INFO]    ',
  mcp:          '[MCP]     ',
  'mcp-ready':  '[MCP]     ',
  thinking:     '[LLM]     ',
  assistant:    '[RESPUESTA]',
  tools:        '[TOOLS]   ',
  'tool-call':  '[TOOL →]  ',
  'tool-result':'[TOOL ←] ',
  'tool-error': '[TOOL ❌] ',
  complete:     '[DONE]    ',
  warning:      '[WARN]    ',
  error:        '[ERROR]   ',
};

// Singleton con inicialización diferida — las vars de entorno están disponibles al arrancar
let _openaiClient = null;
function getOpenAIClient() {
  if (!_openaiClient) {
    const apiKey    = process.env.AZURE_OPENAI_API_KEY;
    const endpoint  = process.env.AZURE_OPENAI_ENDPOINT;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
    if (!apiKey || !endpoint || !apiVersion) {
      throw new Error('Faltan variables de entorno de Azure OpenAI (API_KEY, ENDPOINT, API_VERSION).');
    }
    _openaiClient = new AzureOpenAI({ apiKey, endpoint, apiVersion, timeout: 180_000 });
  }
  return _openaiClient;
}

/**
 * Limpia HTML básico dejando solo texto plano.
 * Útil para respuestas de Azure DevOps que devuelven campos con HTML.
 */
function stripHtml(str) {
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extrae texto plano de un resultado MCP.
 * El protocolo MCP retorna: { content: [{ type: 'text', text: '...' }], isError: bool }
 */
function extractMCPText(result) {
  if (!result) return '(sin resultado)';

  if (result.content && Array.isArray(result.content)) {
    const raw = result.content
      .filter((c) => c.type === 'text')
      .map((c) => {
        let text = c.text;
        // Si el texto es un JSON (ej. respuesta de Azure DevOps), parsearlo y
        // re-serializarlo para decodificar escapes Unicode (\u00f3 → ó)
        // y evitar que el LLM los interprete como texto literal.
        const trimmed = text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            text = JSON.stringify(parsed, null, 2);
          } catch (_) { /* no era JSON válido, usar texto original */ }
        }
        return text;
      })
      .join('\n') || JSON.stringify(result);
    // Si la respuesta contiene HTML (típico de Azure DevOps), limpiarlo
    return raw.includes('<') ? stripHtml(raw) : raw;
  }
  return JSON.stringify(result);
}

/**
 * Ejecuta un agente completo con streaming de progreso.
 *
 * @param {object}   opts
 * @param {string}   opts.agentName   - id o name del agente
 * @param {string}   opts.prompt      - instrucción del usuario
 * @param {function} opts.onProgress  - callback({ type, message, [args] })
 */
async function runAgent({ agentName, prompt, onProgress, signal }) {
  // ── Wrap onProgress para duplicar todos los eventos a la consola del servidor ──
  const _emit = onProgress;
  onProgress = (event) => {
    const prefix = PREFIX_MAP[event.type] || '[LOG]     ';
    console.log(`${prefix} ${event.message || JSON.stringify(event)}`);
    _emit(event);
  };

  // ── 1. Cargar agente ───────────────────────────────────────────────────────
  const agent = getAgent(agentName);
  if (!agent) throw new Error(`Agente '${agentName}' no encontrado.`);

  onProgress({ type: 'start', message: `🤖 Agente: ${agent.name}` });

  // ── 2. Inicializar servidores MCP ──────────────────────────────────────────
  const mcpManager = new MCPManager();
  await mcpManager.initializeForAgent(agent, onProgress);

  // ── 3. Construir herramientas OpenAI ───────────────────────────────────────
  // Estrategia de filtrado inteligente para el servidor (el YAML se mantiene intacto
  // para VS Code Copilot). Para cada servidor MCP declarado en el YAML:
  //
  //   AZURE DEVOPS (~40 tools): se aplica reducción en orden de prioridad:
  //     1. Menciones explícitas en el system prompt (azure-devops/wit_get_work_item)
  //     2. Subcategorías detectadas por keywords del prompt + descripción del agente
  //        (ej. "historia de usuario" → wit_*, "caso de prueba" → testplan_*)
  //     3. Fallback: todas las azure-devops del YAML (seguro, sin pérdida de funcionalidad)

  // Palabras clave por subcategoría — definidas a nivel módulo como AZDEVOPS_SUBCATEGORY_KEYWORDS
  // agentFullText viene precalculado y cacheado en el objeto agente por agentReader
  const agentFullText = agent.fullText;

  // Servidores MCP que tienen lógica de filtrado especial — COMPLEX_FILTER_SERVERS a nivel módulo

  // Servidores MCP usados por este agente (extraído del YAML) — todos los prefijos conocidos
  const yamlMcpServers = new Set(
    agent.tools
      .map((t) => t.split('/')[0])
      .filter((p) => p && !['read', 'edit', 'search', 'web', 'execute'].includes(p))
  );

  // Construir la lista efectiva de tools MCP a enviar al LLM
  const effectiveFilter = [];

  for (const server of yamlMcpServers) {
    const yamlServerTools = agent.tools.filter((t) => t.startsWith(`${server}/`));

    // Servidores "simples" (fabric-mcp, powerbi-modeling-mcp, etc.):
    // usar los nombres REALES que reportó el MCP al iniciar, no los del YAML
    // (el YAML puede declarar más nombres de los que realmente existen en el MCP)
    if (!COMPLEX_FILTER_SERVERS.has(server)) {
      const actualTools = mcpManager.getServerTools(server);
      if (actualTools.length > 0) {
        const actualNames = actualTools.map((t) => `${server}/${t.name}`);
        effectiveFilter.push(...actualNames);
        console.log(`[agentRunner] Servidor '${server}': ${actualNames.length} tools (${actualNames.slice(0, 5).join(', ')}${actualNames.length > 5 ? ` +${actualNames.length - 5} más` : ''})`);
      } else {
        // fallback: usar nombres del YAML si el MCP aún no reportó tools
        effectiveFilter.push(...yamlServerTools);
        console.log(`[agentRunner] Servidor '${server}': ${yamlServerTools.length} tools del YAML (MCP sin tools reales aún)`);
      }
      continue;
    }

    if (server === 'azure-devops') {
      // Paso 1: menciones explícitas en el system prompt.
      // Si el prompt menciona herramientas que no existen en el MCP real,
      // no debemos dejar al agente con 0 herramientas. Por eso intersectamos
      // con las tools reales reportadas por el servidor y solo usamos las válidas.
      const actualTools = mcpManager.getServerTools(server);
      const actualNames = new Set(actualTools.map((t) => `azure-devops/${t.name}`.toLowerCase()));

      const explicitRe = /azure-devops\/([a-z][a-z0-9_]+)/g;
      const explicitSet = new Set();
      let em;
      while ((em = explicitRe.exec(agent.systemPrompt)) !== null) {
        const fullName = `azure-devops/${em[1]}`.toLowerCase();
        if (actualNames.has(fullName)) {
          explicitSet.add(fullName);
        }
      }

      // Prioridad especial para agentes de HU/Work Item:
      // si el prompt habla de HU, historia de usuario o work item por ID,
      // solo exponer herramientas WIT y preferir la de get individual.
      const wantsSingleWorkItem =
        /\bhu\b|\bhistoria(s)? de usuario\b|\bwork item\b|\buser story\b/i.test(agentFullText) &&
        /\b(id|número|numero)\b/i.test(agentFullText);

      if (wantsSingleWorkItem) {
        const witPreferred = actualTools
          .map((t) => t.name)
          .filter((name) => /^wit_/i.test(name))
          .sort((a, b) => {
            const aScore = /work_item$/i.test(a) ? 0 : /query|backlog|batch|comment|attachment|link/i.test(a) ? 2 : 1;
            const bScore = /work_item$/i.test(b) ? 0 : /query|backlog|batch|comment|attachment|link/i.test(b) ? 2 : 1;
            return aScore - bScore;
          })
          .map((name) => `azure-devops/${name}`);

        if (witPreferred.length > 0) {
          effectiveFilter.push(...witPreferred);
          continue;
        }
      }

      if (explicitSet.size > 0) {
        effectiveFilter.push(...explicitSet);
        continue;
      }

      // Paso 2: detección de subcategorías por keywords
      const detectedCats = Object.entries(AZDEVOPS_SUBCATEGORY_KEYWORDS)
        .filter(([, keywords]) => keywords.some((kw) => agentFullText.includes(kw)))
        .map(([cat]) => cat);

      if (detectedCats.length > 0) {
        const catTools = actualTools
          .filter((t) => detectedCats.some((cat) => t.name.startsWith(`${cat}_`) || t.name === cat))
          .map((t) => `azure-devops/${t.name}`);
        if (catTools.length > 0) {
          effectiveFilter.push(...catTools);
          continue;
        }
      }

      // Paso 3: fallback — usar las herramientas REALES del MCP.
      // Esto evita mismatch entre el YAML del agente y los nombres realmente
      // expuestos por la versión instalada del servidor MCP.
      if (actualTools.length > 0) {
        effectiveFilter.push(...actualTools.map((t) => `azure-devops/${t.name}`));
      } else {
        effectiveFilter.push(...yamlServerTools);
      }
    }
  }

  // Si el YAML no declara ningún servidor MCP, no se pasan tools MCP
  const mcpFilter = effectiveFilter.length > 0 ? effectiveFilter : agent.tools;
  const mcpTools = mcpManager.toOpenAITools(mcpFilter);
  const tools = [...mcpTools, ...WORKSPACE_TOOL_DEFS];
  const workspaceNames = new Set(WORKSPACE_TOOL_DEFS.map((t) => t.function.name));

  onProgress({
    type: 'info',
    message: `🔧 ${mcpTools.length} herramienta(s) MCP + ${WORKSPACE_TOOL_DEFS.length} workspace tools disponibles`,
  });

  // ── 4. Crear cliente Azure OpenAI ──────────────────────────────────────────
  const client = getOpenAIClient();

  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!deployment) throw new Error('Falta la variable de entorno AZURE_OPENAI_DEPLOYMENT.');

  // ── 5. Bucle agente ────────────────────────────────────────────────────────
  // TOOL_NAME_MAP definida a nivel módulo — reemplaza nombres de tools de VS Code por workspace__*
  let resolvedPrompt = agent.systemPrompt;
  for (const [pattern, replacement] of TOOL_NAME_MAP) {
    resolvedPrompt = resolvedPrompt.replace(pattern, replacement);
  }

  // ── NUEVO: Inyectar información de skills disponibles ────────────────────────
  const skills = getSkills();
  if (skills.length > 0) {
    const skillsList = skills
      .map((s) => `- **${s.name}** (${s.id}): ${s.description}`)
      .join('\n');
    resolvedPrompt += `\n\n[SKILLS DISPONIBLES]:\nLos siguientes skills están disponibles en este workspace. Cuando necesites usarlos, llama a la herramienta \`workspace__loadSkill\` con el nombre de la skill para obtener instrucciones detalladas:\n\n${skillsList}`;
  }

  // ── NUEVO: Configuración Azure DevOps obligatoria desde .env ─────────────────
  if (yamlMcpServers.has('azure-devops')) {
    const azureOrgUrl = (process.env.AZURE_DEVOPS_ORG_URL || '').trim();
    const azureProject = (process.env.AZURE_DEVOPS_PROJECT || '').trim();

    resolvedPrompt += `\n\n[CONFIGURACIÓN OBLIGATORIA DE AZURE DEVOPS]:` +
      `\n- organization_url válida: ${azureOrgUrl || '(no definida)'}` +
      `\n- project válido: ${azureProject || '(no definido)'}` +
      `\n- Debes usar única y exclusivamente esos valores.` +
      `\n- Está prohibido usar una organización distinta, anterior, inferida, recordada o construida manualmente.` +
      `\n- Si necesitas consultar Azure DevOps y el MCP falla o no está disponible, debes reportar el error real.` +
      `\n- No uses web/fetch para consultar Azure DevOps con URLs armadas manualmente.` +
      `\n- Si en cualquier texto previo aparece otra organización, ignórala por completo y considera como verdad única la configuración actual del .env.`;
  }

  // ── NUEVO: Forzar autonomía absoluta ─────────────────────────────────────────
  resolvedPrompt += '\n\n[REGLA ESTRICTA DEL SISTEMA]: Eres un agente 100% autónomo. NO pidas confirmación, permiso ni instrucciones adicionales al usuario en ningún momento. Ejecuta la totalidad de tu tarea paso a paso tal como esta definido. Escribe siempre en español estándar. Nunca me entregues archivos vacios o sin sentido solo para pedirme que los revise. Si necesitas revisar algo, hazlo tú mismo usando tus herramientas y luego continúa con tu flujo de trabajo sin interrumpirte. Si terminas tu tarea pero no has guardado archivos, haz un paso final de guardado antes de finalizar.';

  const messages = [
    { role: 'system', content: resolvedPrompt },
    { role: 'user', content: prompt },
  ];

  onProgress({ type: 'thinking', message: `💭 Enviando prompt al modelo '${deployment}'…` });

  let completed = false;
  const startTime = Date.now();

  // Acumuladores de tokens — response.usage los provee Azure OpenAI en cada llamada
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Rastreo de guardado de archivos para forzar el paso de guardado si el modelo
  // termina con 'stop' sin haber llamado workspace__writeFile.
  let hasCalledAnyTool = false; // ¿el modelo llamó alguna tool en esta ejecución?
  let hasWrittenFiles = false; // ¿llamó workspace__writeFile al menos una vez?
  let injectedSaveStep = false; // ¿ya inyectamos el mensaje de guardado?
  let saveStepIter = 0;     // iteraciones transcurridas desde la inyección del save-step
  const writtenFilesSet = new Set(); // rutas únicas de archivos guardados durante la ejecución

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // ── VERIFICACIÓN DE CANCELACIÓN 1 ──
      if (signal && signal.aborted) {
        throw { name: 'AbortError', message: 'Ejecución abortada por el usuario.' };
      }
      // Construir parámetros de la petición.
      // Si ya inyectamos el paso de guardado, usamos tool_choice:'required'
      // para obligar al modelo a llamar una tool (no puede responder solo con texto).
      const requestParams = { model: deployment, messages };
      if (tools.length > 0) {
        requestParams.tools = tools;
        // tool_choice:'required' solo mientras estemos en el save-step Y el modelo
        // aún no ha escrito nada — en cuanto escribe el primer archivo volvemos a
        // 'auto' para que el modelo pueda terminar naturalmente (y escribir los
        // archivos restantes sin que nosotros lo cortemos antes de tiempo).
        requestParams.tool_choice = (injectedSaveStep && !hasWrittenFiles) ? 'required' : 'auto';
      }

      if (injectedSaveStep) saveStepIter++;

      onProgress({ type: 'info', message: `⟳ Iteración ${iter + 1}/${MAX_ITERATIONS}` });

      // Llamada al LLM — con reintentos automáticos ante error 429 (Rate Limit)
      let response;
      {
        const MAX_LLM_RETRIES = 3;
        const BASE_WAIT_MS    = 15_000; // 15 s → 30 s → 60 s
        let attempt = 0;
        while (true) {
          try {
            response = await client.chat.completions.create(requestParams);
            break; // éxito → salir del bucle de reintentos
          } catch (llmErr) {
            const isRateLimit =
              llmErr.status === 429 ||
              (llmErr.message && llmErr.message.includes('429'));

            if (isRateLimit && attempt < MAX_LLM_RETRIES) {
              attempt++;
              const waitMs  = BASE_WAIT_MS * Math.pow(2, attempt - 1); // 15 s, 30 s, 60 s
              const waitSec = Math.round(waitMs / 1000);
              onProgress({
                type: 'warning',
                message: `⏳ Límite de tokens Azure alcanzado (429) — reintento ${attempt}/${MAX_LLM_RETRIES} en ${waitSec}s…`,
              });
              await new Promise((resolve) => setTimeout(resolve, waitMs));
              continue;
            }

            // Error no recuperable o reintentos agotados
            const hint =
              llmErr.status === 400 ? ' (posible contexto demasiado largo)' :
              llmErr.status === 429 ? ` (límite de tokens agotado tras ${MAX_LLM_RETRIES} reintentos)` :
              '';
            throw new Error(`Error en Azure OpenAI${hint}: ${llmErr.message}`);
          }
        }
      }

      const choice = response.choices[0];
      const msg = choice.message;

      // ── Tokens de esta iteración ────────────────────────────────────────────
      if (response.usage) {
        const u = response.usage;
        totalPromptTokens += u.prompt_tokens || 0;
        totalCompletionTokens += u.completion_tokens || 0;
        onProgress({
          type: 'info',
          message: `📊 Tokens iter ${iter + 1}: prompt=${u.prompt_tokens} │ completion=${u.completion_tokens} │ total=${u.total_tokens}`,
        });
      }

      // Añadir mensaje del asistente al historial
      const assistantEntry = { role: 'assistant', content: msg.content ?? null };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        assistantEntry.tool_calls = msg.tool_calls;
      }
      messages.push(assistantEntry);

      // Mostrar contenido textual del asistente
      if (msg.content) {
        onProgress({ type: 'assistant', message: msg.content });
      }

      // Registrar si el modelo llamó tools en esta iteración
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        hasCalledAnyTool = true;
      }

      // ── Fin de ejecución ─────────────────────────────────────────────────
      if (choice.finish_reason === 'stop' || !msg.tool_calls || msg.tool_calls.length === 0) {
        // Si el agente ya hizo trabajo pero NO guardó archivos, forzar el paso de guardado.
        // Solo lo hacemos una vez (injectedSaveStep evita bucle infinito).
        if (hasCalledAnyTool && !hasWrittenFiles && !injectedSaveStep) {
          injectedSaveStep = true;
          onProgress({
            type: 'info',
            message: '📌 El agente terminó sin guardar archivos — forzando paso de guardado…',
          });
          const saveMessage = agentName === 'agente-excel'
            ? 'Has completado el análisis pero TODAVÍA no has guardado el archivo Excel. ' +
              'Ejecuta AHORA mismo los pasos de guardado llamando a la herramienta workspace__generateExcel. ' +
              'NO respondas con texto. Solo ejecuta las tools de guardado.'
            : 'Has completado el análisis pero TODAVÍA no has guardado los archivos. ' +
              'Ejecuta AHORA mismo los pasos de guardado: ' +
              'primero llama workspace__createDirectory para crear el directorio, ' +
              'luego llama workspace__writeFile para guardar CADA archivo del workflow. ' +
              'NO respondas con texto. Solo ejecuta las tools de guardado.';
          messages.push({
            role: 'user',
            content: saveMessage,
          });
          continue; // reiniciar bucle con tool_choice:'required'
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        onProgress({ type: 'complete', message: `✅ Agente completó la ejecución en ${elapsed}s.` });
        onProgress({
          type: 'info',
          message: `📊 Tokens totales: prompt=${totalPromptTokens} │ completion=${totalCompletionTokens} │ TOTAL=${totalPromptTokens + totalCompletionTokens}`,
        });
        completed = true;
        break;
      }

      // ── Procesar tool_calls ───────────────────────────────────────────────
      const wsCount = msg.tool_calls.filter((tc) => workspaceNames.has(tc.function.name)).length;
      const mcpCount = msg.tool_calls.length - wsCount;
      onProgress({
        type: 'tools',
        message: `⚡ Ejecutando ${msg.tool_calls.length} herramienta(s)` +
          (wsCount > 0 ? ` (${wsCount} workspace)` : '') +
          (mcpCount > 0 ? ` (${mcpCount} MCP)` : '') + '…',
      });

      for (const toolCall of msg.tool_calls) {

        // ── VERIFICACIÓN DE CANCELACIÓN 2 ──
        if (signal && signal.aborted) {
          throw { name: 'AbortError', message: 'Ejecución abortada por el usuario.' };
        }

        let args;

        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (parseErr) {
          // Si el LLM falla al escapar comillas/saltos de línea (típico en .md),
          // le devolvemos el error explícito para que él mismo corrija su formato.
          const errMsg = `Error de formato: Los argumentos no son un JSON válido. Asegúrate de escapar bien las comillas (\\") y los saltos de línea (\\n). Detalle: ${parseErr.message}`;
          onProgress({ type: 'tool-error', message: `✗ Error de escape JSON en ${toolCall.function.name}` });
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: errMsg });
          continue; // Saltamos la ejecución, el LLM intentará de nuevo en la siguiente iteración
        }

        const isWorkspaceTool = workspaceNames.has(toolCall.function.name);
        const toolDisplayName = isWorkspaceTool
          ? toolCall.function.name.replace('workspace__', '') + (args.path ? ` → ${args.path}` : '')
          : toolCall.function.name;

        onProgress({ type: 'tool-call', message: toolDisplayName });

        let toolResultContent;
        try {
          if (isWorkspaceTool) {
            // ── Workspace tool (sistema de archivos local) ──────────────
            const toolShortName = toolCall.function.name.replace('workspace__', '');
            if (toolShortName === 'writeFile') {
              hasWrittenFiles = true; // marcar guardado
              if (args.path) writtenFilesSet.add(args.path);
            } else if (toolShortName === 'generateExcel') {
              hasWrittenFiles = true; // marcar guardado
              if (args.outputPath) writtenFilesSet.add(args.outputPath);
            }
            // fetchUrl devuelve una Promise; await funciona para síncronos y asíncronos
            const result = await Promise.resolve(callWorkspaceTool(toolShortName, args));
            toolResultContent = result;
            onProgress({
              type: 'tool-result',
              message: `← [workspace] ${String(result).substring(0, 500)}${String(result).length > 500 ? '\n…(truncado)' : ''}`,
            });
          } else {
            // ── MCP tool ─────────────────────────────────────────────────
            const raw = await mcpManager.callTool(toolCall.function.name, args);
            const text = extractMCPText(raw);
            // Volcar respuesta raw solo cuando DEBUG_MCP=true para evitar llenar logs en producción
            if (process.env.DEBUG_MCP === 'true' &&
                (toolCall.function.name.includes('azure_devops') || toolCall.function.name.includes('azure-devops'))) {
              const rawStr = JSON.stringify(raw, null, 2);
              console.log(`\n=== [${toolCall.function.name}] RAW (${rawStr.length} chars) ===`);
              console.log(rawStr.substring(0, 4000));
              if (rawStr.length > 4000) console.log(`... (+${rawStr.length - 4000} chars)`);
              console.log('====\n');
            }
            toolResultContent = text.length > MAX_TOOL_RESULT_LLM_CHARS
              ? text.substring(0, MAX_TOOL_RESULT_LLM_CHARS) +
              `\n[...resultado truncado: ${text.length - MAX_TOOL_RESULT_LLM_CHARS} caracteres omitidos]`
              : text;
            onProgress({
              type: 'tool-result',
              message: `← ${text.substring(0, 500)}${text.length > 500 ? '\n…(truncado)' : ''}`,
            });
          }
        } catch (toolErr) {
          toolResultContent = `Error al ejecutar herramienta: ${toolErr.message}`;
          onProgress({ type: 'tool-error', message: `✗ ${toolCall.function.name}: ${toolErr.message}` });
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResultContent,
        });
      } // fin for toolCall

      // ── Corte de seguridad en el save-step ────────────────────────────────
      // Después de inyectar el mensaje de guardado el modelo termina normalmente
      // cuando llega a finish_reason:'stop' (con tool_choice:'auto'). Este cap es
      // solo una red de seguridad para evitar loops infinitos si algo sale mal.
      // 10 iteraciones extra son más que suficientes para escribir cualquier cantidad
      // de archivos, y aplica por igual a todos los agentes.
      if (injectedSaveStep && saveStepIter >= 10) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        onProgress({ type: 'complete', message: `✅ Agente completó la ejecución en ${elapsed}s.` });
        onProgress({
          type: 'info',
          message: `📊 Tokens totales: prompt=${totalPromptTokens} │ completion=${totalCompletionTokens} │ TOTAL=${totalPromptTokens + totalCompletionTokens}`,
        });
        completed = true;
        break;
      }
    } // fin for

    if (!completed) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      onProgress({
        type: 'warning',
        message: `⚠️ Límite de ${MAX_ITERATIONS} iteraciones alcanzado (${elapsed}s). El agente puede no haber terminado.`,
      });
      onProgress({
        type: 'info',
        message: `📊 Tokens acumulados: prompt=${totalPromptTokens} │ completion=${totalCompletionTokens} │ TOTAL=${totalPromptTokens + totalCompletionTokens}`,
      });
    }

  } finally {
    await mcpManager.cleanup();
  }
  return { writtenFiles: [...writtenFilesSet] };
}

module.exports = { runAgent };
