'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const { getAgents } = require('./services/agentReader');
const { runAgent } = require('./services/agentRunner');
const { getDashboardData } = require('./services/dashboardService');
const MCPClient   = require('./services/mcpClient');
const fabricClient = require('./services/fabricClient');
const powerbiClient = require('./services/powerbiClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.AGENT_UI_PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── REST ──────────────────────────────────────────────────────────────────────
app.get('/api/dashboard', (_req, res) => {
  try {
    const data = getDashboardData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseMarkdownHU(mdContent) {
  const hu = {
    story_id: '',
    story_title: '',
    story_description: '',
    acceptance_criteria: [],
    score_initial: 0,
    score_final: 0,
    iterations_count: 1,
    key_improvements: ''
  };

  // 1. Título e ID
  const titleMatch = mdContent.match(/^##\s+(.+)$/m);
  if (titleMatch) hu.story_title = titleMatch[1].trim();

  const idMatch = mdContent.match(/### Story ID\r?\n(\d+)/i);
  if (idMatch) hu.story_id = idMatch[1].trim();

  // 2. Descripción
  const descStartIndex = mdContent.indexOf('### Descripción');
  if (descStartIndex !== -1) {
    const nextSectionIndex = mdContent.indexOf('###', descStartIndex + 15);
    const descSection = mdContent.substring(descStartIndex + 15, nextSectionIndex !== -1 ? nextSectionIndex : mdContent.length).trim();
    hu.story_description = descSection;
  }

  // 3. Criterios de Aceptación
  const criteriaStartIndex = mdContent.indexOf('### Criterios de Aceptación');
  if (criteriaStartIndex !== -1) {
    const nextSectionIndex = mdContent.indexOf('###', criteriaStartIndex + 27);
    const criteriaSection = mdContent.substring(criteriaStartIndex + 27, nextSectionIndex !== -1 ? nextSectionIndex : mdContent.length).trim();
    const lines = criteriaSection.split('\n');
    lines.forEach(line => {
      const cleanedLine = line.replace(/^\d+\.\s+/, '').replace(/^-\s+/, '').trim();
      if (cleanedLine) hu.acceptance_criteria.push(cleanedLine);
    });
  }

  // 4. Información de mejora
  const scoreInitialMatch = mdContent.match(/\*\*Score Inicial:\*\*\s*(\d+)/i);
  if (scoreInitialMatch) hu.score_initial = parseInt(scoreInitialMatch[1], 10);

  const scoreFinalMatch = mdContent.match(/\*\*Score Final:\*\*\s*(\d+)/i);
  if (scoreFinalMatch) hu.score_final = parseInt(scoreFinalMatch[1], 10);

  const iterMatch = mdContent.match(/\*\*Iteraciones:\*\*\s*(\d+)/i);
  if (iterMatch) hu.iterations_count = parseInt(iterMatch[1], 10);

  const improvementsMatch = mdContent.match(/\*\*Cambios Principales:\*\*\s*(.+)/i);
  if (improvementsMatch) hu.key_improvements = improvementsMatch[1].trim();

  return hu;
}

app.get('/api/read-draft', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'Falta el parámetro path.' });

  const WORKSPACE_ROOT = path.join(__dirname, '..');
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
    } catch (parseErr) {
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
        throw parseErr;
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save-draft', async (req, res) => {
  const { path: relPath, content, agentId } = req.body;
  if (!relPath || !content) return res.status(400).json({ error: 'Faltan parámetros obligatorios.' });

  const WORKSPACE_ROOT = path.join(__dirname, '..');
  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  try {
    // 1. Guardar el archivo JSON actualizado
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(content, null, 2), 'utf8');

    const generatedFiles = [relPath];

    // 2. Si el agente es 'agente-excel', recompilar el Excel
    if (agentId === 'agente-excel') {
      const { generateExcel } = require('./services/excelGenerator');
      const excelRelPath = relPath.replace(/\.json$/, '.xlsx');
      const absExcel = path.resolve(WORKSPACE_ROOT, excelRelPath);
      await generateExcel(absExcel, content);
      generatedFiles.push(excelRelPath);
    }

    // 3. Si el agente es 'mejorar-hu', actualizar la descripción en el Markdown (.md)
    if (agentId === 'mejorar-hu' || relPath.endsWith('-final.json')) {
      const mdRelPath = relPath.replace(/\.json$/, '.md');
      const absMd = path.resolve(WORKSPACE_ROOT, mdRelPath);
      const hu = content;
      
      const mdContent = `---
story_id: "${hu.story_id || ''}"
story_title: "${hu.story_title || ''}"
score_initial: ${hu.score_initial || 0}
score_final: ${hu.score_final || 0}
---

# HU #${hu.story_id || ''}: ${hu.story_title || ''}

## Descripción
${hu.story_description || ''}

## Criterios de Aceptación
${Array.isArray(hu.acceptance_criteria) ? hu.acceptance_criteria.map(ca => `- ${ca}`).join('\n') : ''}
`;
      fs.writeFileSync(absMd, mdContent, 'utf8');
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

  // Seguridad: normalizar y verificar que la ruta quede dentro del workspace
  const WORKSPACE_ROOT = path.join(__dirname, '..');
  const abs = path.resolve(WORKSPACE_ROOT, relPath);
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  const fs = require('fs');
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Archivo no encontrado.' });

  const filename = path.basename(abs);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(abs);
});

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
    // 3. Abortar la ejecución en el backend si el frontend se desconecta (Botón Detener)
    const controller = activeRuns.get(socket.id);
    if (controller) {
      controller.abort();
      activeRuns.delete(socket.id);
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
