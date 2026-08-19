/* global io */
'use strict';

// =============================================================================
// AI QA Platform — Frontend Logic
// =============================================================================

// -- DOM refs -----------------------------------------------------------------
const statusDot       = document.getElementById('statusDot');
const statusLabel     = document.getElementById('statusLabel');
const agentSelect     = document.getElementById('agentSelect');
const agentCard       = document.getElementById('agentCard');
const promptInput     = document.getElementById('promptInput');
const runBtn          = document.getElementById('runBtn');
const stopBtn         = document.getElementById('stopBtn');
const clearBtn        = document.getElementById('clearBtn');
const downloadsBar    = document.getElementById('downloadsBar');
const downloadsList   = document.getElementById('downloadsList');
const activityIdle    = document.getElementById('activityIdle');
const activityRunning = document.getElementById('activityRunning');
const activityResult  = document.getElementById('activityResult');
const activityFeed    = document.getElementById('activityFeed');
const spinnerLabel    = document.getElementById('spinnerLabel');
const resultIcon      = document.getElementById('resultIcon');
const resultTitle     = document.getElementById('resultTitle');
const resultDesc      = document.getElementById('resultDesc');

// -- State --------------------------------------------------------------------
let agents    = [];
let isRunning = false;
let cancelledByUser = false; // evita que agent-done sobreescriba el mensaje de cancelación

// -- Socket.IO ----------------------------------------------------------------
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect',       () => { setStatus('connected', '● Conectado'); loadAgents(); });
socket.on('disconnect',    () => { setStatus('disconnected', '○ Desconectado'); if (isRunning) finishRun(false, 'Conexión perdida'); });
socket.on('connect_error', () => { setStatus('disconnected', '✗ Error de conexión'); });

socket.on('agent-progress', handleProgress);
socket.on('agent-done', ({ success, error, files }) => {
  if (cancelledByUser) { cancelledByUser = false; return; }
  finishRun(success, error, files);
});

// -- Traducción de eventos a mensajes amigables -------------------------------
const SPINNER_LABELS = {
  start:          'Iniciando agente…',
  mcp:            'Conectando herramientas externas…',
  'mcp-ready':    'Herramientas listas',
  thinking:       'El agente está analizando tu solicitud…',
  tools:          'Ejecutando acciones…',
  'tool-call':    'Consultando datos…',
  'tool-result':  'Procesando respuesta…',
  assistant:      'El agente está procesando información…',
  complete:       '¡Proceso completado!',
};

// Solo estos tipos generan cards en el feed
const FEED_TYPES = new Set(['assistant', 'tool-call', 'tool-error', 'warning', 'tokens']);

const TOKEN_RE = /Tokens totales:.*TOTAL=(\d+)/i;

function friendlyToolMessage(rawMessage) {
  const m = rawMessage.toLowerCase();
  if (m.includes('executecommand') || m.includes('npm run') || m.includes('npx playwright')) return 'Ejecutando tests de automatización…';
  if (m.includes('wit_get_work_item') || m.includes('work_item'))      return 'Consultando Historia de Usuario en Azure DevOps…';
  if (m.includes('wit_update') || m.includes('update_work'))           return 'Actualizando elemento en Azure DevOps…';
  if (m.includes('azure') || m.includes('devops') || m.includes('ado')) return 'Comunicándose con Azure DevOps…';
  if (m.includes('navigate') || m.includes('browser_navigate'))        return 'Explorando la aplicación web…';
  if (m.includes('snapshot') || m.includes('screenshot'))              return 'Capturando estado de la interfaz…';
  if (m.includes('fill') || m.includes('click') || m.includes('type')) return 'Interactuando con la interfaz…';
  if (m.includes('writefile') || m.includes('write_file'))             return 'Guardando archivos generados…';
  if (m.includes('readfile') || m.includes('read_file'))               return 'Leyendo archivos del proyecto…';
  if (m.includes('network') || m.includes('request'))                  return 'Analizando llamadas de red…';
  if (m.includes('loadskill') || m.includes('load_skill'))             return 'Cargando instrucciones especializadas…';
  if (m.includes('createdirectory') || m.includes('mkdir'))            return 'Preparando estructura de carpetas…';
  return 'Procesando solicitud…';
}

function handleProgress(event) {
  const { type, message } = event;

  // Mostrar resumen de tokens al recibir el evento info con totales
  if (type === 'info' && TOKEN_RE.test(message)) {
    const match = message.match(/prompt=(\d+).*completion=(\d+).*TOTAL=(\d+)/i);
    if (match) {
      const item = document.createElement('div');
      item.className = 'feed-item feed-item--tokens';
      item.innerHTML = `<div class="feed-item__icon">📊</div><div class="feed-item__text">Tokens usados: ${Number(match[3]).toLocaleString('es-CO')} (prompt: ${Number(match[1]).toLocaleString('es-CO')} • respuesta: ${Number(match[2]).toLocaleString('es-CO')})</div>`;
      activityFeed.appendChild(item);
      activityFeed.scrollTop = activityFeed.scrollHeight;
    }
    return;
  }

  // Actualizar label del spinner
  if (SPINNER_LABELS[type]) {
    spinnerLabel.textContent = SPINNER_LABELS[type];
  }

  if (!FEED_TYPES.has(type)) return;

  const item = document.createElement('div');
  let itemClass = 'feed-item--tool';
  let icon = '⚡';
  let text = '';

  if (type === 'assistant') {
    itemClass = 'feed-item--agent';
    icon = '🤖';
    text = message.length > 220 ? message.substring(0, 220) + '…' : message;
  } else if (type === 'tool-call') {
    itemClass = 'feed-item--tool';
    icon = '⚡';
    text = friendlyToolMessage(message);
  } else if (type === 'tool-error' || type === 'warning') {
    itemClass = 'feed-item--warn';
    icon = '⚠';
    text = 'Se encontró un inconveniente menor, el agente lo está manejando…';
  }

  item.className = `feed-item ${itemClass}`;
  item.innerHTML = `
    <div class="feed-item__icon">${icon}</div>
    <div class="feed-item__text">${escHtml(text)}</div>
  `;

  activityFeed.appendChild(item);
  activityFeed.scrollTop = activityFeed.scrollHeight;
}

// -- Load Agents --------------------------------------------------------------
async function loadAgents(retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('/api/agents');
      agents    = await res.json();

      agentSelect.innerHTML = '<option value="">\u2014 Selecciona un agente \u2014</option>';
      for (const a of agents) {
        const opt       = document.createElement('option');
        opt.value       = a.id;
        opt.textContent = a.name;
        agentSelect.appendChild(opt);
      }
      agentSelect.disabled = false;
      return;
    } catch (err) {
      if (attempt < retries) {
        agentSelect.innerHTML = `<option value="">Conectando\u2026 (intento ${attempt}/${retries})</option>`;
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        agentSelect.innerHTML = '<option value="">Error al cargar agentes \u2014 recarga la p\u00e1gina</option>';
        console.error('loadAgents fallido tras', retries, 'intentos:', err);
      }
    }
  }
}

// -- Agent Selection ----------------------------------------------------------
agentSelect.addEventListener('change', () => {
  const id    = agentSelect.value;
  const agent = agents.find((a) => a.id === id);

  if (!agent) {
    agentCard.innerHTML = '<p class="agent-card__placeholder">Selecciona un agente para ver su descripción.</p>';
    runBtn.disabled = true;
    return;
  }

  renderAgentCard(agent);
  runBtn.disabled = !promptInput.value.trim();
});

promptInput.addEventListener('input', () => {
  runBtn.disabled = !agentSelect.value || !promptInput.value.trim() || isRunning;
});

function renderAgentCard(agent) {
  const playwrightTools = (agent.tools || []).filter((t) => t.startsWith('playwright/')).length;
  const azureTools      = (agent.tools || []).filter((t) => t.startsWith('azure-devops/')).length;
  const otherTools      = (agent.tools || []).length - playwrightTools - azureTools;

  const badges = [];
  if (playwrightTools) badges.push(`<span class="tool-badge tool-badge--playwright">Playwright</span>`);
  if (azureTools)      badges.push(`<span class="tool-badge tool-badge--azure">Azure DevOps</span>`);
  if (otherTools)      badges.push(`<span class="tool-badge tool-badge--more">+${otherTools} herramientas</span>`);

  agentCard.innerHTML = `
    <div class="agent-card__name">${escHtml(agent.name)}</div>
    <div class="agent-card__desc">${escHtml(agent.description)}</div>
    <div class="agent-card__tools">${badges.join('')}</div>
  `;
}

// -- Run / Stop ---------------------------------------------------------------
runBtn.addEventListener('click', startRun);

stopBtn.addEventListener('click', () => {
  cancelledByUser = true;
  socket.emit('cancel-agent');
  finishRun(false, 'Ejecución cancelada por el usuario.');
});

function startRun() {
  const agentId = agentSelect.value;
  const prompt  = promptInput.value.trim();
  if (!agentId || !prompt || isRunning) return;

  isRunning = true;
  runBtn.classList.add('running');
  runBtn.disabled = true;
  stopBtn.classList.remove('hidden');
  setStatus('running', '● Ejecutando agente…');

  // Limpiar feed anterior y resetear spinner
  activityFeed.innerHTML = '';
  spinnerLabel.textContent = 'Iniciando agente…';

  showState('running');
  socket.emit('run-agent', { agentName: agentId, prompt });
}

// DOM refs adicionales para el editor interactivo
const editorContainer = document.getElementById('editorContainer');
const editorContent   = document.getElementById('editorContent');
const editorCancelBtn = document.getElementById('editorCancelBtn');
const editorSaveBtn   = document.getElementById('editorSaveBtn');

// Variables de estado del editor
let currentDraftPath = null;
let currentDraftData = null;
let currentAgentId   = null;
let currentFinalFiles = [];
let currentReviewMode = 'edit'; // 'edit' | 'automation'

function finishRun(success, errorMsg, files) {
  isRunning = false;
  runBtn.classList.remove('running');
  runBtn.disabled = !agentSelect.value || !promptInput.value.trim();
  stopBtn.classList.add('hidden');
  setStatus('connected', '● Conectado');

  if (!success) {
    showState('result');
    resultIcon.className  = 'result-icon result-icon--err';
    resultIcon.textContent = '✗';
    resultTitle.textContent = 'Se produjo un error';
    resultDesc.textContent  = errorMsg || 'El agente encontró un problema durante la ejecución.';
    downloadsBar.classList.add('hidden');
    return;
  }

  // Si tiene éxito, verificar primero si hay archivos .spec.ts (agente de automatización)
  const specFiles = findSpecFiles(files || []);
  if (specFiles.length > 0) {
    openAutomationReview(specFiles, files || []);
    return;
  }

  // Verificar si podemos cargar un borrador interactivo (HU / Casos de Prueba)
  const jsonPath = findJsonFile(files || []);
  if (jsonPath) {
    openInteractiveEditor(jsonPath, files, agentSelect.value);
  } else {
    // Flujo normal directo
    showState('result');
    resultIcon.className  = 'result-icon result-icon--ok';
    resultIcon.textContent = '✓';
    resultTitle.textContent = '¡Proceso completado!';
    resultDesc.textContent  = 'El agente finalizó exitosamente. Puedes descargar los archivos generados.';
    renderDownloads(files || []);
  }
}

// -- State Switcher -----------------------------------------------------------
function showState(state) {
  activityIdle.classList.add('hidden');
  activityRunning.classList.add('hidden');
  activityResult.classList.add('hidden');
  editorContainer.classList.add('hidden');

  if (state === 'idle')    activityIdle.classList.remove('hidden');
  if (state === 'running') activityRunning.classList.remove('hidden');
  if (state === 'result')  activityResult.classList.remove('hidden');
  if (state === 'editor')  editorContainer.classList.remove('hidden');
}

// -- Downloads ----------------------------------------------------------------
function renderDownloads(files) {
  if (!files.length) { downloadsBar.classList.add('hidden'); return; }

  downloadsList.innerHTML = '';
  for (const filePath of files) {
    const filename = filePath.split(/[\\/]/).pop();
    const ext      = filename.split('.').pop().toLowerCase();

    const btn     = document.createElement('a');
    btn.className = 'download-btn';
    btn.href      = `/api/download?path=${encodeURIComponent(filePath)}`;
    btn.download  = filename;
    btn.title     = filePath;
    btn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
      </svg>
      <span class="download-btn__name">${escHtml(filename)}</span>
      <span class="download-btn__ext">.${escHtml(ext)}</span>
    `;
    downloadsList.appendChild(btn);
  }

  downloadsBar.classList.remove('hidden');
}

// -- Reset --------------------------------------------------------------------
clearBtn.addEventListener('click', () => {
  showState('idle');
  downloadsBar.classList.add('hidden');
  setStatus('connected', '● Conectado');
});

// -- Keyboard shortcut --------------------------------------------------------
promptInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !runBtn.disabled) startRun();
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD TABS AND LOGIC
// ─────────────────────────────────────────────────────────────────────────────
const tabAgents          = document.getElementById('tabAgents');
const tabDashboard       = document.getElementById('tabDashboard');
const agentsView         = document.getElementById('agentsView');
const dashboardView      = document.getElementById('dashboardView');

const dashTotalCases     = document.getElementById('dashTotalCases');
const dashTotalBugs      = document.getElementById('dashTotalBugs');
const dashAutomatedCount = document.getElementById('dashAutomatedCount');
const dashCoveragePct    = document.getElementById('dashCoveragePct');
const dashHuList         = document.getElementById('dashHuList');

const dashStatusDesigned  = document.getElementById('dashStatusDesigned');
const dashStatusExecuted  = document.getElementById('dashStatusExecuted');
const dashStatusCompleted = document.getElementById('dashStatusCompleted');

const barDesigned        = document.getElementById('barDesigned');
const barExecuted        = document.getElementById('barExecuted');
const barCompleted       = document.getElementById('barCompleted');

const dashGaugeAuto      = document.getElementById('dashGaugeAuto');
const dashGaugeManual    = document.getElementById('dashGaugeManual');
const dashBugsTableBody  = document.getElementById('dashBugsTableBody');

tabAgents.addEventListener('click', () => {
  tabAgents.classList.add('active');
  tabDashboard.classList.remove('active');
  agentsView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
});

tabDashboard.addEventListener('click', () => {
  tabDashboard.classList.add('active');
  tabAgents.classList.remove('active');
  agentsView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  loadDashboard();
});

let dashboardData = null;

async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('Error al cargar datos del dashboard');
    const data = await res.json();
    dashboardData = data;

    // Renderizar la lista de HUs
    dashHuList.innerHTML = '';
    const husEntries = Object.entries(data.hus);
    if (husEntries.length === 0) {
      dashHuList.innerHTML = '<li class="hu-item hu-item--empty">No hay casos de prueba registrados en el workspace.</li>';
      // Limpiar métricas
      dashTotalCases.textContent = '0';
      dashTotalBugs.textContent = '0';
      dashAutomatedCount.textContent = '0';
      dashCoveragePct.textContent = '0%';
      dashStatusDesigned.textContent = '0';
      dashStatusExecuted.textContent = '0';
      dashStatusCompleted.textContent = '0';
      barDesigned.style.width = '0%';
      barExecuted.style.width = '0%';
      barCompleted.style.width = '0%';
      dashGaugeAuto.textContent = '0';
      dashGaugeManual.textContent = '0';
      dashBugsTableBody.innerHTML = '<tr><td colspan="6" class="table-empty">No se han registrado bugs en los reportes de seguimiento.</td></tr>';
      return;
    }

    // Ordenar HUs por número de casos de forma descendente
    husEntries.sort((a, b) => b[1].totalCases - a[1].totalCases);

    husEntries.forEach(([huId, hu]) => {
      const li = document.createElement('li');
      li.className = 'hu-item';
      li.style.cursor = 'pointer';
      li.dataset.huid = huId;
      li.innerHTML = `<span>HU #${escHtml(huId)}</span> <span class="hu-badge">${hu.totalCases} casos</span>`;
      
      li.addEventListener('click', () => {
        renderSelectedHuMetrics(huId);
      });

      dashHuList.appendChild(li);
    });

    // Seleccionar por defecto la primera HU en la lista
    const firstHuId = husEntries[0][0];
    renderSelectedHuMetrics(firstHuId);

  } catch (err) {
    console.error('Error al actualizar dashboard:', err);
    dashHuList.innerHTML = `<li class="hu-item hu-item--empty">⚠️ Error al cargar datos: ${escHtml(err.message)}. Verifica que el servidor esté activo.</li>`;
  }
}

function renderSelectedHuMetrics(huId) {
  if (!dashboardData || !dashboardData.hus) return;
  
  const hu = dashboardData.hus[huId];
  if (!hu) return;

  // 1. Cards de Resumen
  dashTotalCases.textContent = hu.totalCases;
  dashTotalBugs.textContent = hu.bugs ? hu.bugs.length : 0;
  dashAutomatedCount.textContent = hu.automationCounts.Automated;

  const total = hu.totalCases;
  const auto = hu.automationCounts.Automated;
  const pct = total > 0 ? Math.round((auto / total) * 100) : 0;
  dashCoveragePct.textContent = `${pct}%`;

  // 2. Distribución por estados
  dashStatusDesigned.textContent = hu.statusCounts.Designed;
  dashStatusExecuted.textContent = hu.statusCounts.Executed;
  dashStatusCompleted.textContent = hu.statusCounts.Completed;

  const designPct = total > 0 ? (hu.statusCounts.Designed / total) * 100 : 0;
  const execPct   = total > 0 ? (hu.statusCounts.Executed / total) * 100 : 0;
  const compPct   = total > 0 ? (hu.statusCounts.Completed / total) * 100 : 0;

  barDesigned.style.width  = `${designPct}%`;
  barExecuted.style.width  = `${execPct}%`;
  barCompleted.style.width = `${compPct}%`;

  // 3. Desglose de Automatización
  dashGaugeAuto.textContent = hu.automationCounts.Automated;
  dashGaugeManual.textContent = hu.automationCounts.NotAutomated;

  // 4. Tabla de Bugs
  dashBugsTableBody.innerHTML = '';
  if (!hu.bugs || hu.bugs.length === 0) {
    dashBugsTableBody.innerHTML = '<tr><td colspan="6" class="table-empty">No se han registrado bugs para esta HU.</td></tr>';
  } else {
    hu.bugs.forEach(bug => {
      const tr = document.createElement('tr');
      const prio = (bug.prioridad || 'Medio').toLowerCase();
      const priorityClass = `priority-pill--${prio}`;
      const dateStr = bug.fecha ? new Date(bug.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      
      tr.innerHTML = `
        <td><strong>${escHtml(bug.id)}</strong></td>
        <td>${escHtml(bug.modulo)}</td>
        <td>${escHtml(bug.titulo)}</td>
        <td><span class="priority-pill ${priorityClass}">${escHtml(bug.prioridad)}</span></td>
        <td>${escHtml(bug.estado)}</td>
        <td>${escHtml(dateStr)}</td>
      `;
      dashBugsTableBody.appendChild(tr);
    });
  }

  // 5. Destacar la HU activa en la lista
  const items = dashHuList.querySelectorAll('.hu-item');
  items.forEach(item => {
    if (item.dataset.huid === String(huId)) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// -- Helpers ------------------------------------------------------------------
function setStatus(cls, label) {
  statusDot.className     = `status-dot ${cls}`;
  statusLabel.textContent = label;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE QA EDITOR LOGIC
// ─────────────────────────────────────────────────────────────────────────────

function findJsonFile(files) {
  // Buscar directamente un archivo .json
  let jsonFile = files.find(f => f.endsWith('.json'));
  if (jsonFile) return jsonFile;

  // Si solo hay un archivo .xlsx, buscar su correspondiente .json en la misma HU
  let xlsxFile = files.find(f => f.endsWith('.xlsx'));
  if (xlsxFile) {
    return xlsxFile.replace(/\.xlsx$/, '.json');
  }
  return null;
}

async function openInteractiveEditor(jsonPath, originalFiles, agentId) {
  currentDraftPath = jsonPath;
  currentAgentId = agentId;
  currentFinalFiles = originalFiles;

  try {
    const res = await fetch(`/api/read-draft?path=${encodeURIComponent(jsonPath)}`);
    if (!res.ok) throw new Error('No se pudo cargar el borrador.');
    currentDraftData = await res.json();

    // Casos de prueba (test_cases/casos_prueba) tienen prioridad sobre story_id
    // porque el JSON del agente incluye story_id para trazabilidad
    if (Array.isArray(currentDraftData.test_cases) || Array.isArray(currentDraftData.casos_prueba) || Array.isArray(currentDraftData.cases)) {
      renderCasesEditor(currentDraftData);
    } else if (currentDraftData.story_id || currentDraftData.story_title) {
      renderHUEditor(currentDraftData);
    } else {
      // Fallback si la estructura no coincide
      throw new Error('Estructura de JSON no soportada para edición interactiva.');
    }

    showState('editor');
  } catch (err) {
    console.error('Error al abrir editor:', err);
    // Fallback al resultado estándar directo si falla la lectura del borrador
    showState('result');
    resultIcon.className  = 'result-icon result-icon--ok';
    resultIcon.textContent = '✓';
    resultTitle.textContent = '¡Proceso completado!';
    resultDesc.textContent  = 'El agente finalizó exitosamente. Puedes descargar los archivos generados.';
    renderDownloads(originalFiles || []);
  }
}

function renderHUEditor(hu) {
  const criteria = hu.acceptance_criteria || [];
  let criteriaHtml = '';
  criteria.forEach((ca, idx) => {
    criteriaHtml += `
      <div class="editor-criteria-item">
        <input type="text" class="editor-input ca-input-field" value="${escHtml(ca)}" placeholder="Criterio de aceptación">
        <button class="btn btn--danger-outline btn-delete-ca" type="button">Eliminar</button>
      </div>
    `;
  });

  editorContent.innerHTML = `
    <div class="editor-form-group">
      <label>Título de la Historia de Usuario</label>
      <input type="text" id="huTitleInput" class="editor-input" value="${escHtml(hu.story_title || '')}">
    </div>
    <div class="editor-form-group">
      <label>Descripción / Objetivo</label>
      <textarea id="huDescInput" class="editor-textarea" rows="6">${escHtml(hu.story_description || '')}</textarea>
    </div>
    <div class="editor-form-group">
      <label>Criterios de Aceptación</label>
      <div class="editor-criteria-list" id="huCriteriaList">
        ${criteriaHtml}
      </div>
      <button class="btn btn--add-action" id="btnAddCriteria" type="button" style="margin-top: 10px;">
        + Agregar Criterio
      </button>
    </div>
  `;

  // Bind dinámico para agregar/eliminar criterios
  const btnAddCriteria = document.getElementById('btnAddCriteria');
  const huCriteriaList = document.getElementById('huCriteriaList');

  btnAddCriteria.addEventListener('click', () => {
    const item = document.createElement('div');
    item.className = 'editor-criteria-item';
    item.innerHTML = `
      <input type="text" class="editor-input ca-input-field" value="" placeholder="Nuevo criterio de aceptación">
      <button class="btn btn--danger-outline btn-delete-ca" type="button">Eliminar</button>
    `;
    huCriteriaList.appendChild(item);
  });

  huCriteriaList.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-delete-ca') || e.target.closest('.btn-delete-ca')) {
      e.target.closest('.editor-criteria-item').remove();
    }
  });
}

function renderCasesEditor(data) {
  const cases = data.test_cases || data.casos_prueba || data.cases || [];
  
  let casesHtml = '';
  cases.forEach((tc, caseIdx) => {
    let stepsHtml = '';
    const steps = tc.pasos || tc.steps || [];
    steps.forEach((step, stepIdx) => {
      stepsHtml += `
        <div class="editor-step-row" data-index="${stepIdx}">
          <div class="editor-step-number">${stepIdx + 1}</div>
          <div class="editor-step-fields">
            <div class="editor-form-group">
              <label>Acción / Paso</label>
              <textarea class="editor-textarea step-action-input" rows="2">${escHtml(step.accion || step.action || '')}</textarea>
            </div>
            <div class="editor-form-group">
              <label>Datos de prueba</label>
              <textarea class="editor-textarea step-data-input" rows="2">${escHtml(step.data || step.datos || '')}</textarea>
            </div>
            <div class="editor-form-group">
              <label>Resultado Esperado</label>
              <textarea class="editor-textarea step-expected-input" rows="2">${escHtml(step.resultado_esperado || step.expected_result || step.expected || '')}</textarea>
            </div>
          </div>
          <button class="btn btn--danger-outline btn-delete-step" type="button" style="margin-top: 18px;">Eliminar</button>
        </div>
      `;
    });

    const priority = tc.prioridad || tc.priority || 'Alta';
    const caseType = (tc.type || tc.tags || tc.tag || 'api').toLowerCase();

    casesHtml += `
      <div class="editor-case-card" data-index="${caseIdx}">
        <div class="editor-case-header">
          <span class="editor-case-index">Caso #${caseIdx + 1}</span>
          <button class="btn btn--danger-outline btn-delete-case" type="button">Eliminar Caso</button>
        </div>
        
        <div class="editor-form-group">
          <label>Título del Caso de Prueba</label>
          <input type="text" class="editor-input case-title-input" value="${escHtml(tc.titulo || tc.title || '')}">
        </div>

        <div class="editor-case-grid">
          <div class="editor-form-group">
            <label>Prioridad</label>
            <select class="editor-select case-priority-select">
              <option value="Alta" ${priority === 'Alta' ? 'selected' : ''}>Alta</option>
              <option value="Media" ${priority === 'Media' ? 'selected' : ''}>Media</option>
              <option value="Bajo" ${priority === 'Bajo' || priority === 'Baja' ? 'selected' : ''}>Bajo</option>
            </select>
          </div>
          <div class="editor-form-group">
            <label>Tipo (API / WEB)</label>
            <select class="editor-select case-tag-select">
              <option value="api" ${caseType === 'api' ? 'selected' : ''}>API</option>
              <option value="web" ${caseType === 'web' ? 'selected' : ''}>WEB</option>
            </select>
          </div>
        </div>

        <div class="editor-form-group">
          <label>Descripción</label>
          <textarea class="editor-textarea case-description-input" rows="3">${escHtml(tc.description || tc.descripcion || '')}</textarea>
        </div>
        <div class="editor-form-group">
          <label>Objetivo</label>
          <textarea class="editor-textarea case-objective-input" rows="2">${escHtml(tc.objective || tc.objetivo || '')}</textarea>
        </div>
        <div class="editor-form-group">
          <label>Rol</label>
          <input type="text" class="editor-input case-role-input" value="${escHtml(tc.role || tc.rol || '')}">
        </div>
        <div class="editor-form-group">
          <label>Precondiciones</label>
          <textarea class="editor-textarea case-preconditions-input" rows="3">${escHtml(Array.isArray(tc.preconditions) ? tc.preconditions.join('\n') : Array.isArray(tc.precondiciones) ? tc.precondiciones.join('\n') : (tc.preconditions || tc.precondiciones || ''))}</textarea>
        </div>
        <div class="editor-form-group">
          <label>Postcondiciones</label>
          <textarea class="editor-textarea case-postcondition-input" rows="2">${escHtml(tc.post_condition || tc.postcondicion || '')}</textarea>
        </div>

        <div class="editor-steps-section">
          <div class="editor-steps-header">
            <span class="editor-steps-title">Pasos del Escenario</span>
            <button class="btn btn--add-action btn-add-step" type="button">+ Agregar Paso</button>
          </div>
          <div class="editor-steps-list">
            ${stepsHtml}
          </div>
        </div>
      </div>
    `;
  });

  editorContent.innerHTML = `
    <div class="editor-cases-list" id="editorCasesList">
      ${casesHtml}
    </div>
    <button class="btn btn--add-action" id="btnAddCase" style="margin-top: 20px; width: 100%;">
      + Agregar Nuevo Caso de Prueba
    </button>
  `;

  const editorCasesList = document.getElementById('editorCasesList');
  const btnAddCase = document.getElementById('btnAddCase');

  btnAddCase.addEventListener('click', () => {
    const card = document.createElement('div');
    card.className = 'editor-case-card';
    const caseIdx = editorCasesList.children.length;
    card.innerHTML = `
      <div class="editor-case-header">
        <span class="editor-case-index">Caso #${caseIdx + 1}</span>
        <button class="btn btn--danger-outline btn-delete-case" type="button">Eliminar Caso</button>
      </div>
      
      <div class="editor-form-group">
        <label>Título del Caso de Prueba</label>
        <input type="text" class="editor-input case-title-input" value="" placeholder="Título del nuevo caso">
      </div>

      <div class="editor-case-grid">
        <div class="editor-form-group">
          <label>Prioridad</label>
          <select class="editor-select case-priority-select">
            <option value="Alta">Alta</option>
            <option value="Media">Media</option>
            <option value="Bajo">Bajo</option>
          </select>
        </div>
        <div class="editor-form-group">
          <label>Tipo (API / WEB)</label>
          <select class="editor-select case-tag-select">
            <option value="api">API</option>
            <option value="web">WEB</option>
          </select>
        </div>
      </div>

      <div class="editor-form-group">
        <label>Descripción</label>
        <textarea class="editor-textarea case-description-input" rows="3" placeholder="Descripción del caso de prueba"></textarea>
      </div>
      <div class="editor-form-group">
        <label>Objetivo</label>
        <textarea class="editor-textarea case-objective-input" rows="2" placeholder="Objetivo del caso"></textarea>
      </div>
      <div class="editor-form-group">
        <label>Rol</label>
        <input type="text" class="editor-input case-role-input" value="" placeholder="Rol del usuario">
      </div>
      <div class="editor-form-group">
        <label>Precondiciones</label>
        <textarea class="editor-textarea case-preconditions-input" rows="3" placeholder="Una precondición por línea"></textarea>
      </div>
      <div class="editor-form-group">
        <label>Postcondiciones</label>
        <textarea class="editor-textarea case-postcondition-input" rows="2" placeholder="Postcondición del caso"></textarea>
      </div>

      <div class="editor-steps-section">
        <div class="editor-steps-header">
          <span class="editor-steps-title">Pasos del Escenario</span>
          <button class="btn btn--add-action btn-add-step" type="button">+ Agregar Paso</button>
        </div>
        <div class="editor-steps-list">
        </div>
      </div>
    `;
    editorCasesList.appendChild(card);
  });

  editorCasesList.addEventListener('click', (e) => {
    const target = e.target;
    
    if (target.classList.contains('btn-delete-case')) {
      target.closest('.editor-case-card').remove();
      Array.from(editorCasesList.children).forEach((card, idx) => {
        card.querySelector('.editor-case-index').textContent = `Caso #${idx + 1}`;
      });
      return;
    }

    if (target.classList.contains('btn-add-step')) {
      const stepsList = target.closest('.editor-steps-section').querySelector('.editor-steps-list');
      const stepIdx = stepsList.children.length;
      const stepRow = document.createElement('div');
      stepRow.className = 'editor-step-row';
      stepRow.innerHTML = `
        <div class="editor-step-number">${stepIdx + 1}</div>
        <div class="editor-step-fields">
          <div class="editor-form-group">
            <label>Acción / Paso</label>
            <textarea class="editor-textarea step-action-input" rows="2" placeholder="Describe la acción"></textarea>
          </div>
          <div class="editor-form-group">
            <label>Datos de prueba</label>
            <textarea class="editor-textarea step-data-input" rows="2" placeholder="Datos necesarios para este paso"></textarea>
          </div>
          <div class="editor-form-group">
            <label>Resultado Esperado</label>
            <textarea class="editor-textarea step-expected-input" rows="2" placeholder="Describe el resultado esperado"></textarea>
          </div>
        </div>
        <button class="btn btn--danger-outline btn-delete-step" type="button" style="margin-top: 18px;">Eliminar</button>
      `;
      stepsList.appendChild(stepRow);
      return;
    }

    if (target.classList.contains('btn-delete-step')) {
      const stepRow = target.closest('.editor-step-row');
      const stepsList = stepRow.parentElement;
      stepRow.remove();
      Array.from(stepsList.children).forEach((row, idx) => {
        row.querySelector('.editor-step-number').textContent = idx + 1;
      });
    }
  });
}

function serializeEditorData() {
  const hasCases = Array.isArray(currentDraftData.test_cases) || Array.isArray(currentDraftData.casos_prueba) || Array.isArray(currentDraftData.cases);
  if (!hasCases && (currentDraftData.story_id || currentDraftData.story_title)) {
    const acceptance_criteria = [];
    document.querySelectorAll('.ca-input-field').forEach(input => {
      const val = input.value.trim();
      if (val) acceptance_criteria.push(val);
    });

    return {
      ...currentDraftData,
      story_title: document.getElementById('huTitleInput').value.trim(),
      story_description: document.getElementById('huDescInput').value.trim(),
      acceptance_criteria
    };
  } else {
    const cases = [];
    document.querySelectorAll('.editor-case-card').forEach(card => {
      const title = card.querySelector('.case-title-input').value.trim();
      const prioridad = card.querySelector('.case-priority-select').value;
      const type = card.querySelector('.case-tag-select').value;

      const pasos = [];
      card.querySelectorAll('.editor-step-row').forEach((row, idx) => {
        pasos.push({
          numero: idx + 1,
          accion: row.querySelector('.step-action-input').value.trim(),
          data: row.querySelector('.step-data-input').value.trim(),
          resultado_esperado: row.querySelector('.step-expected-input').value.trim()
        });
      });

      cases.push({
        titulo: title,
        type,
        description: card.querySelector('.case-description-input').value.trim(),
        objective: card.querySelector('.case-objective-input').value.trim(),
        role: card.querySelector('.case-role-input').value.trim(),
        preconditions: card.querySelector('.case-preconditions-input').value.trim()
          .split('\n').map(l => l.trim()).filter(Boolean),
        post_condition: card.querySelector('.case-postcondition-input').value.trim(),
        prioridad,
        pasos
      });
    });

    // Preservar todos los metadatos del JSON original; solo reemplazar el array de casos
    const caseKey = Array.isArray(currentDraftData.test_cases) ? 'test_cases' : 'casos_prueba';
    return { ...currentDraftData, [caseKey]: cases };
  }
}

// Confirmar sin cambios
editorCancelBtn.addEventListener('click', () => {
  resetEditorHeader();
  showState('result');
  resultIcon.className  = 'result-icon result-icon--ok';
  resultIcon.textContent = '✓';
  resultTitle.textContent = '¡Proceso completado!';
  resultDesc.textContent  = 'El agente finalizó exitosamente. Los archivos se guardaron sin cambios manuales.';
  renderDownloads(currentFinalFiles);
});

// Guardar y Confirmar
editorSaveBtn.addEventListener('click', async () => {
  if (currentReviewMode === 'automation') {
    resetEditorHeader();
    showState('result');
    resultIcon.className  = 'result-icon result-icon--ok';
    resultIcon.textContent = '✓';
    resultTitle.textContent = 'Automatización aprobada';
    resultDesc.textContent  = 'Los tests han sido aprobados. Descarga los archivos para integrarlos al proyecto.';
    // Excluir archivos internos de Playwright (results.json, carpeta reports/)
    const downloadable = currentFinalFiles.filter(f => !/results\.json$/.test(f) && !/[\\/]reports[\\/]/.test(f));
    renderDownloads(downloadable);
    return;
  }

  editorSaveBtn.disabled = true;
  editorSaveBtn.textContent = 'Guardando…';

  try {
    const updatedData = serializeEditorData();

    const res = await fetch('/api/save-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: currentDraftPath,
        content: updatedData,
        agentId: currentAgentId
      })
    });

    if (!res.ok) throw new Error('Error al guardar los cambios en el servidor.');

    const saveResult = await res.json();

    if (saveResult.success && saveResult.files) {
      currentFinalFiles = saveResult.files;
    }

    showState('result');
    resultIcon.className  = 'result-icon result-icon--ok';
    resultIcon.textContent = '✓';
    resultTitle.textContent = '¡Cambios guardados!';
    resultDesc.textContent  = 'Tus modificaciones fueron guardadas y los archivos finales compilados correctamente.';
    renderDownloads(currentFinalFiles);
    showToast('¡Cambios guardados exitosamente!', 'success');
  } catch (err) {
    showToast(`Error al guardar: ${err.message}`, 'error');
  } finally {
    editorSaveBtn.disabled = false;
    editorSaveBtn.textContent = 'Confirmar y Guardar';
  }
});

function showToast(message, type = 'error') {
  // Eliminar toast anterior si existe
  const oldToast = document.getElementById('customToast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.id = 'customToast';
  toast.className = `custom-toast custom-toast--${type}`;
  
  const icon = type === 'success' ? '✓' : '✗';
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${escHtml(message)}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  document.body.appendChild(toast);
  
  // Auto-eliminar después de 4 segundos
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATION REVIEW — HITL para el agente "Automatizar y Ejecutar"
// ─────────────────────────────────────────────────────────────────────────────

function findSpecFiles(files) {
  return (files || []).filter(f => /\.spec\.(ts|js)$/.test(f));
}

function detectReportUrl(specFiles) {
  const paths = (specFiles || []).map(f => f.replace(/\\/g, '/'));
  if (paths.some(p => p.includes('automatizacion api'))) return '/reports/api/index.html';
  if (paths.some(p => p.includes('automatizacion web'))) return '/reports/web/index.html';
  return '/reports/api/index.html'; // fallback
}

async function openAutomationReview(specFiles, allFiles) {
  currentFinalFiles = allFiles;
  currentReviewMode = 'automation';

  let testResults = null;
  const resultsPath = allFiles.find(f => f.endsWith('results.json'));
  if (resultsPath) {
    try {
      const r = await fetch(`/api/read-draft?path=${encodeURIComponent(resultsPath)}`);
      if (r.ok) testResults = await r.json();
    } catch (_) {}
  }

  const specContents = [];
  for (const p of specFiles.slice(0, 3)) {
    try {
      const r = await fetch(`/api/read-text?path=${encodeURIComponent(p)}`);
      if (r.ok) specContents.push({ path: p, code: await r.text() });
    } catch (_) {}
  }

  renderAutomationReview(testResults, specContents, specFiles);
  showState('editor');
}

function renderAutomationReview(testResults, specContents, specFiles) {
  const titleEl    = document.querySelector('.editor-title');
  const subtitleEl = document.querySelector('.editor-subtitle');
  if (titleEl)    titleEl.textContent    = 'Revisar Automatización Generada';
  if (subtitleEl) subtitleEl.textContent = 'Verifica el código generado y los resultados antes de aprobar.';
  editorSaveBtn.textContent   = 'Aprobar y Descargar';
  editorCancelBtn.textContent = 'Ver sin aprobar';

  const reportUrl = detectReportUrl(specFiles);
  const reportBtn = `<a class="btn btn--report" href="${reportUrl}" target="_blank" rel="noopener">
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
      <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
      <path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.992 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.235.235 0 0 1 .02-.022z"/>
    </svg>
    Ver Reporte Completo ↗
  </a>`;

  let resultsHtml = '';

  if (testResults && testResults.stats) {
    const s = testResults.stats;
    const passed  = s.expected   || 0;
    const failed  = s.unexpected || 0;
    const skipped = s.skipped    || 0;
    const okClass = failed > 0 ? 'auto-status--fail' : 'auto-status--pass';
    const okText  = failed > 0 ? `${failed} test(s) fallido(s)` : 'Todos los tests pasaron ✅';

    let failedList = '';
    if (failed > 0 && testResults.suites) {
      const titles = [];
      (function collect(suites) {
        (suites || []).forEach(s => {
          (s.specs || []).forEach(sp => { if (!sp.ok) titles.push(sp.title); });
          if (s.suites) collect(s.suites);
        });
      })(testResults.suites);
      if (titles.length) {
        failedList = `<div class="auto-failures">
          <p class="auto-failures-title">❌ Tests fallidos:</p>
          <ul>${titles.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>
        </div>`;
      }
    }

    resultsHtml = `
      <div class="auto-review-header">
        <span class="auto-status-badge ${okClass}">${okText}</span>
        ${reportBtn}
      </div>
      <div class="auto-review-results">
        <div class="auto-stat auto-stat--pass"><span class="auto-stat-val">${passed}</span><span class="auto-stat-label">Pasados</span></div>
        <div class="auto-stat auto-stat--fail"><span class="auto-stat-val">${failed}</span><span class="auto-stat-label">Fallidos</span></div>
        <div class="auto-stat auto-stat--skip"><span class="auto-stat-val">${skipped}</span><span class="auto-stat-label">Saltados</span></div>
      </div>
      ${failedList}
    `;
  } else {
    resultsHtml = `<div class="auto-review-header">
      <span class="auto-status-badge auto-status--info">Tests ejecutados</span>
      ${reportBtn}
    </div>`;
  }

  const specsHtml = specContents.length
    ? specContents.map(({ path: p, code }) => {
        const name    = p.split(/[\\/]/).pop();
        const preview = code.length > 3000 ? code.substring(0, 3000) + '\n\n// … (archivo completo disponible en descarga)' : code;
        return `<div class="auto-file-section">
          <div class="auto-file-header">
            <span class="auto-file-name">📄 ${escHtml(name)}</span>
            <a class="btn btn--secondary auto-file-download" href="/api/download?path=${encodeURIComponent(p)}" download="${escHtml(name)}">↓ Descargar</a>
          </div>
          <pre class="auto-code-preview">${escHtml(preview)}</pre>
        </div>`;
      }).join('')
    : `<p style="color:var(--text-2);text-align:center;padding:24px;">Los archivos fueron guardados en el workspace.</p>`;

  editorContent.innerHTML = `<div class="auto-review">${resultsHtml}${specsHtml}</div>`;
}

function resetEditorHeader() {
  currentReviewMode = 'edit';
  const titleEl    = document.querySelector('.editor-title');
  const subtitleEl = document.querySelector('.editor-subtitle');
  if (titleEl)    titleEl.textContent    = 'Revisar y Editar Resultados';
  if (subtitleEl) subtitleEl.textContent = 'Revisa o modifica los datos generados antes de confirmar la creación del archivo final.';
  editorSaveBtn.textContent   = 'Confirmar y Guardar';
  editorCancelBtn.textContent = 'Confirmar sin cambios';
}