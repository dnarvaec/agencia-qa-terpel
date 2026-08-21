'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const { getAgents } = require('./services/agentReader');
const { runAgent } = require('./services/agentRunner');
const { getDashboardData, parseMarkdownHU } = require('./services/dashboardService');
const MCPClient   = require('./services/mcpClient');
const fabricClient = require('./services/fabricClient');
const powerbiClient = require('./services/powerbiClient');
const { repairJsonControlChars, tryParseJson } = require('./services/workspaceTools');

const app = express();
const server = http.createServer(app);
// CORS restringido a localhost; ampliar via AGENT_UI_ORIGIN en .env para acceso remoto
const CORS_ORIGIN = process.env.AGENT_UI_ORIGIN || /^http:\/\/localhost(:\d+)?$/;
const io = new Server(server, { cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] } });

const PORT = process.env.AGENT_UI_PORT || 3000;
const WORKSPACE_ROOT = path.join(__dirname, '..');

const MIME_TYPES = {
  json: 'application/json; charset=utf-8',
  md:   'text/markdown; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv:  'text/csv; charset=utf-8',
  txt:  'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

const MAX_PROMPT_LENGTH = 8000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ── REST ──────────────────────────────────────────────────────────────────────
let _dashboardCache = null;
let _dashboardCacheAt = 0;
const DASHBOARD_TTL_MS = 5_000;

app.get('/api/dashboard', (_req, res) => {
  try {
    const now = Date.now();
    if (!_dashboardCache || now - _dashboardCacheAt > DASHBOARD_TTL_MS) {
      _dashboardCache = getDashboardData();
      _dashboardCacheAt = now;
    }
    res.json(_dashboardCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/read-draft', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'Falta el parámetro path.' });

  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  try {
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }
    const content = fs.readFileSync(abs, 'utf8');
    try {
      res.json(JSON.parse(content));
    } catch (_) {
      // Intentar reparar con todas las estrategias disponibles
      const parsed = tryParseJson(content.trim());
      if (parsed !== null) {
        res.json(parsed);
        return;
      }
      // Último recurso: intentar reconstruir desde el .md equivalente
      console.warn(`JSON corrupto en ${relPath}, intentando fallback a Markdown...`);
      const mdRelPath = relPath.replace(/\.json$/, '.md');
      const absMd = path.resolve(WORKSPACE_ROOT, mdRelPath);
      if (fs.existsSync(absMd)) {
        const mdContent = fs.readFileSync(absMd, 'utf8');
        const parsedHU = parseMarkdownHU(mdContent);
        if (!parsedHU.story_id) {
          const match = path.basename(relPath).match(/^(\d+)-final/);
          if (match) parsedHU.story_id = match[1];
        }
        res.json(parsedHU);
      } else {
        res.status(422).json({ error: 'El archivo JSON está corrupto y no se pudo reparar automáticamente.' });
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save-draft', async (req, res) => {
  const { path: relPath, content, agentId } = req.body;
  if (!relPath || !content) return res.status(400).json({ error: 'Faltan parámetros obligatorios.' });

  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  try {
    // 1. Guardar el archivo JSON actualizado
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(content, null, 2), 'utf8');

    const generatedFiles = [relPath];

    // Los reportes de confirmación de carga a Azure (-azure-upload.json) los construye
    // el propio agente; este endpoint nunca debe regenerar su .md (evita corromperlo
    // con la plantilla de casos de prueba si el payload trae un `casos_prueba`/`cases`).
    const isAzureUploadFile = relPath.endsWith('-azure-upload.json');

    // 2. Si el agente es 'mejorar-hu', actualizar la descripción en el Markdown (.md)
    const normalizedId = (agentId || '').toLowerCase().replace(/[\s]+/g, '-');
    if (isAzureUploadFile) {
      // No-op: el .md de confirmación no se regenera desde aquí.
    } else if (normalizedId === 'mejorar-hu' || relPath.endsWith('-final.json')) {
      const mdRelPath = relPath.replace(/\.json$/, '.md');
      const absMd = path.resolve(WORKSPACE_ROOT, mdRelPath);
      const hu = content;
      
      const bodyLines = [
        `# HU #${hu.story_id || ''}: ${hu.story_title || ''}`,
        ``,
        `## Descripción`,
        hu.story_description || '',
        ``,
        `## Criterios de Aceptación`,
        Array.isArray(hu.acceptance_criteria)
          ? hu.acceptance_criteria.map(ca => `- ${ca}`).join('\n')
          : '',
      ];
      if (hu.key_improvements) {
        bodyLines.push(``, `## Mejoras Aplicadas`, hu.key_improvements);
      }

      // Metadatos al final — mismos campos y orden que el JSON
      const metaFields = [];
      if (hu.score_initial != null || hu.score_final != null)
        metaFields.push(`**Score inicial:** ${hu.score_initial ?? 0} → **Score final:** ${hu.score_final ?? 0}`);
      if (hu.iterations_count != null)
        metaFields.push(`**Iteraciones:** ${hu.iterations_count}`);
      if (hu.source)
        metaFields.push(`**Fuente:** ${hu.source}`);
      if (hu.azure_devops_id)
        metaFields.push(`**ID Azure DevOps:** ${hu.azure_devops_id}`);
      if (hu.project)
        metaFields.push(`**Proyecto:** ${hu.project}`);
      if (hu.generated_at)
        metaFields.push(`**Generado:** ${hu.generated_at}`);
      if (metaFields.length > 0) {
        bodyLines.push(``, `---`, ...metaFields);
      }

      const mdContent = `${bodyLines.join('\n')}\n`;
      fs.writeFileSync(absMd, mdContent, 'utf8');
      generatedFiles.push(mdRelPath);

    } else if (Array.isArray(content.casos_prueba) || Array.isArray(content.test_cases)) {
      // Generar .md para casos de prueba
      const mdRelPath = relPath.replace(/\.json$/, '.md');
      const absMd = path.resolve(WORKSPACE_ROOT, mdRelPath);
      const cases = content.casos_prueba || content.test_cases || [];
      const storyIdMatch = path.basename(relPath).match(/^(\d+)/);
      const storyId = content.story_id || (storyIdMatch ? storyIdMatch[1] : '');
      const storyTitle = content.story_title || '';

      const tcLines = [
        `# Casos de Prueba${storyId ? ` — HU-${storyId}` : ''}${storyTitle ? `: ${storyTitle}` : ''}`,
        ``,
      ];

      if (content.generated_at) tcLines.push(`**Fecha de generación:** ${content.generated_at}`, ``);

      if (content.environment && Object.keys(content.environment).length > 0) {
        const envCols = Object.keys(content.environment);
        tcLines.push(`## Entorno`);
        tcLines.push(`| ${envCols.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' | ')} |`);
        tcLines.push(`| ${envCols.map(() => '---').join(' | ')} |`);
        tcLines.push(`| ${envCols.map(c => String(content.environment[c] || 'N/A').replace(/\|/g, '&#124;')).join(' | ')} |`);
        tcLines.push(``);
      }

      if (content.credentials) {
        const credRows = Object.values(content.credentials).filter(Array.isArray).flat();
        tcLines.push(`## Credenciales`);
        tcLines.push(`| Usuario | Rol | Contraseña |`);
        tcLines.push(`|---------|-----|------------|`);
        if (credRows.length > 0) {
          credRows.forEach(r => tcLines.push(`| ${r.usuario || r.user || 'N/A'} | ${r.rol || r.role || ''} | ${r.contrasena || r.password || ''} |`));
        } else {
          tcLines.push(`| N/A | (ver .env) | (ver .env) |`);
        }
        tcLines.push(``);
      }

      if (content.summary) {
        const s = content.summary;
        tcLines.push(`## Resumen`);
        tcLines.push(`| Total Web | Total API | Total Manual | Total |`);
        tcLines.push(`|-----------|-----------|--------------|-------|`);
        tcLines.push(`| ${s.total_web ?? 0} | ${s.total_api ?? 0} | ${s.total_manual ?? 0} | ${s.total ?? cases.length} |`);
        tcLines.push(``);
      }

      tcLines.push(`## Casos de Prueba`, ``);

      cases.forEach((tc) => {
        const titulo = tc.titulo || tc.title || '';
        const id = tc.id || '';
        const tipo = (tc.type || tc.tags || tc.tag || 'api').toLowerCase();
        const prioridad = (tc.prioridad || tc.priority || '').toLowerCase();
        const pasos = tc.pasos || tc.steps || [];
        const preconds = tc.preconditions || tc.precondiciones || [];
        const rol = (tc.role || tc.rol || '').replace(/\|/g, '&#124;');
        const obj = (tc.objective || tc.objetivo || '').replace(/\|/g, '&#124;');

        tcLines.push(`---`, ``);
        tcLines.push(id ? `### ${id} — ${titulo}` : `### ${titulo}`, ``);
        tcLines.push(`| Tipo | Prioridad | Rol | Objetivo |`);
        tcLines.push(`|------|-----------|-----|---------|`);
        tcLines.push(`| ${tipo} | ${prioridad} | ${rol} | ${obj} |`);
        tcLines.push(``);

        if (tc.description || tc.descripcion) {
          tcLines.push(`**Descripción:**`, tc.description || tc.descripcion, ``);
        }

        if (Array.isArray(preconds) && preconds.length > 0) {
          tcLines.push(`**Precondiciones:**`);
          preconds.forEach(p => tcLines.push(`- ${p}`));
          tcLines.push(``);
        }

        if (pasos.length > 0) {
          tcLines.push(`**Pasos:**`);
          tcLines.push(`| # | Acción | Datos de prueba | Resultado Esperado |`);
          tcLines.push(`|---|--------|----------------|-------------------|`);
          pasos.forEach(p => {
            const num  = p.numero || p.order || '';
            const acc  = (p.accion || p.action || '').replace(/\|/g, '&#124;').replace(/\n/g, ' ');
            const data = (p.data   || p.datos  || '').replace(/\|/g, '&#124;').replace(/\n/g, ' ');
            const exp  = (p.resultado_esperado || p.expected_result || p.expected || '').replace(/\|/g, '&#124;').replace(/\n/g, ' ');
            tcLines.push(`| ${num} | ${acc} | ${data} | ${exp} |`);
          });
          tcLines.push(``);
        }

        if (tc.post_condition || tc.postcondicion) {
          tcLines.push(`**Post-condición:**`, tc.post_condition || tc.postcondicion, ``);
        }

        const acCovered = tc.acceptance_criteria_covered || tc.criterios_aceptacion_cubiertos;
        if (Array.isArray(acCovered) && acCovered.length > 0) {
          tcLines.push(`**Criterios de Aceptación cubiertos:**`);
          acCovered.forEach(ac => tcLines.push(`- ${ac}`));
          tcLines.push(``);
        }

        if (tc.automation_notes || tc.notas_automatizacion) {
          tcLines.push(`**Notas de Automatización:**`, tc.automation_notes || tc.notas_automatizacion, ``);
        }
      });

      const tcMdContent = `${tcLines.join('\n')}\n`;
      fs.writeFileSync(absMd, tcMdContent, 'utf8');
      generatedFiles.push(mdRelPath);
    }

    res.json({ success: true, files: generatedFiles });
  } catch (err) {
    console.error('Error al guardar borrador:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents', (_req, res) => {
  try {
    const agents = getAgents().map(({ id, name, description, tools }) => ({ id, name, description, tools }));
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'Falta el parámetro path.' });

  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Archivo no encontrado.' });

  const filename = path.basename(abs);
  const ext = filename.split('.').pop().toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);
  res.sendFile(abs);
});

app.get('/api/read-text', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'Falta el parámetro path.' });
  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'No encontrado.' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(fs.readFileSync(abs, 'utf8'));
});

// Playwright HTML reports servidos para visualización in-browser
app.use('/reports/api', express.static(path.join(WORKSPACE_ROOT, 'automatizacion api', 'reports')));
app.use('/reports/web', express.static(path.join(WORKSPACE_ROOT, 'automatizacion web', 'reports')));

// ── Fabric API ────────────────────────────────────────────────────────────────
app.get('/api/fabric/explore', async (_req, res) => {
  try { res.json(await fabricClient.explore(process.env.FABRIC_WORKSPACE_ID)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/fabric/health', async (_req, res) => {
  try { res.json(await fabricClient.health(process.env.FABRIC_WORKSPACE_ID)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fabric/pipeline/:pipelineId/run', async (req, res) => {
  try { res.json(await fabricClient.runPipeline(process.env.FABRIC_WORKSPACE_ID, req.params.pipelineId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/fabric/pipeline/:pipelineId/runs', async (req, res) => {
  try { res.json(await fabricClient.getPipelineRuns(process.env.FABRIC_WORKSPACE_ID, req.params.pipelineId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/fabric/lakehouse/:lakehouseId/tables', async (req, res) => {
  try { res.json(await fabricClient.getLakehouseTables(process.env.FABRIC_WORKSPACE_ID, req.params.lakehouseId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Power BI API ──────────────────────────────────────────────────────────────
app.get('/api/powerbi/discover', async (_req, res) => {
  try { res.json(await powerbiClient.discover(process.env.POWERBI_WORKSPACE_ID)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/powerbi/refresh/:datasetId', async (req, res) => {
  try { res.json(await powerbiClient.getRefreshHistory(process.env.POWERBI_WORKSPACE_ID, req.params.datasetId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/powerbi/refresh/:datasetId', async (req, res) => {
  try { res.json(await powerbiClient.triggerRefresh(process.env.POWERBI_WORKSPACE_ID, req.params.datasetId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/powerbi/dataset/:datasetId', async (req, res) => {
  try { res.json(await powerbiClient.getDataset(process.env.POWERBI_WORKSPACE_ID, req.params.datasetId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/powerbi/dataset/:datasetId/query', async (req, res) => {
  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Se requiere el campo query con la expresión DAX.' });
  try { res.json(await powerbiClient.executeDax(process.env.POWERBI_WORKSPACE_ID, req.params.datasetId, query)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
// Mapa para guardar las ejecuciones activas y poder cancelarlas
const activeRuns = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  socket.on('run-agent', async ({ agentName, prompt }) => {
    if (!agentName || !prompt) {
      socket.emit('agent-progress', { type: 'error', message: 'Se requieren agentName y prompt.' });
      socket.emit('agent-done', { success: false });
      return;
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      socket.emit('agent-progress', { type: 'error', message: `El prompt excede el límite de ${MAX_PROMPT_LENGTH} caracteres.` });
      socket.emit('agent-done', { success: false });
      return;
    }

    // 1. Crear un controlador para esta ejecución
    const controller = new AbortController();
    activeRuns.set(socket.id, controller);

    try {
      const { writtenFiles } = await runAgent({
        agentName,
        prompt,
        signal: controller.signal, // <-- Pasamos la señal al agente
        onProgress: (event) => socket.emit('agent-progress', event),
      });
      socket.emit('agent-done', { success: true, files: writtenFiles || [] });
    } catch (err) {
      // 2. Distinguir entre cancelación voluntaria y un error real
      if (err.name === 'AbortError') {
        socket.emit('agent-progress', { type: 'warning', message: 'Ejecución cancelada en el servidor.' });
      } else {
        socket.emit('agent-progress', { type: 'error', message: `Error fatal: ${err.message}` });
      }
      socket.emit('agent-done', { success: false, error: err.message });
    } finally {
      // Limpiar el mapa al terminar
      activeRuns.delete(socket.id);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Desconectado: ${socket.id}`);
    const controller = activeRuns.get(socket.id);
    if (controller) {
      controller.abort();
      activeRuns.delete(socket.id);
    }
  });

  socket.on('cancel-agent', () => {
    const controller = activeRuns.get(socket.id);
    if (controller) {
      controller.abort();
      activeRuns.delete(socket.id);
      console.log(`[Socket] Ejecución cancelada por el usuario: ${socket.id}`);
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀  Agent UI iniciado → http://localhost:${PORT}\n`);
});

// ── Limpieza de procesos MCP al cerrar el servidor ────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[Server] Señal ${signal} recibida — terminando procesos MCP hijos...`);
  MCPClient.stopAll();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err.message, err.stack));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
