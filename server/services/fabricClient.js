'use strict';
/**
 * fabricClient.js
 * Proxy hacia la Fabric REST API usando las credenciales SP del .env.
 * No requiere dependencias externas — usa el módulo https nativo de Node.
 */
const https = require('https');

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let r = ''; res.on('data', d => r += d); res.on('end', () => { try { resolve(JSON.parse(r)); } catch { resolve(r); } }); }
    );
    req.on('error', reject); req.write(data); req.end();
  });
}

function get(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'GET',
        headers: { Authorization: `Bearer ${token}` } },
      (res) => { let r = ''; res.on('data', d => r += d); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(r) }); } catch { resolve({ status: res.statusCode, body: r }); } }); }
    );
    req.on('error', reject); req.end();
  });
}

function postJson(url, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let r = ''; res.on('data', d => r += d); res.on('end', () => { try { resolve({ status: res.statusCode, body: r ? JSON.parse(r) : {} }); } catch { resolve({ status: res.statusCode, body: r }); } }); }
    );
    req.on('error', reject); req.write(data); req.end();
  });
}

// ── Token con caché (55 min) ──────────────────────────────────────────────────
let _token = null, _exp = 0;
async function getToken() {
  if (_token && Date.now() < _exp) return _token;
  const { AZURE_TENANT_ID: tid, AZURE_CLIENT_ID: cid, AZURE_CLIENT_SECRET: cs } = process.env;
  if (!tid || !cid || !cs) throw new Error('Faltan AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET en .env');
  const res = await post(`https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
    { client_id: cid, client_secret: cs, scope: 'https://api.fabric.microsoft.com/.default', grant_type: 'client_credentials' });
  if (!res.access_token) throw new Error('Token Fabric no obtenido: ' + JSON.stringify(res));
  _token = res.access_token;
  _exp = Date.now() + ((res.expires_in || 3600) - 300) * 1000;
  return _token;
}

// ── API pública ───────────────────────────────────────────────────────────────
const BASE = 'https://api.fabric.microsoft.com/v1';

async function explore(wsId) {
  const token = await getToken();
  const [wsRes, itemsRes, lhRes, plRes] = await Promise.all([
    get(`${BASE}/workspaces/${wsId}`, token),
    get(`${BASE}/workspaces/${wsId}/items`, token),
    get(`${BASE}/workspaces/${wsId}/lakehouses`, token),
    get(`${BASE}/workspaces/${wsId}/dataPipelines`, token),
  ]);
  if (wsRes.status !== 200) throw new Error(`Workspace ${wsId} inaccesible (HTTP ${wsRes.status}): ${JSON.stringify(wsRes.body)}`);

  const items = itemsRes.body.value || [];
  const lakehouses = (lhRes.body.value || []).map(lh => ({
    id: lh.id, name: lh.displayName,
  }));
  const pipelines = (plRes.body.value || []).map(p => ({ id: p.id, name: p.displayName }));

  return {
    workspace:  { id: wsId, name: wsRes.body.displayName },
    lakehouses,
    pipelines,
    items_by_type: items.reduce((acc, i) => {
      (acc[i.type] = acc[i.type] || []).push({ id: i.id, name: i.displayName });
      return acc;
    }, {}),
    stats: {
      total_items:      items.length,
      total_lakehouses: lakehouses.length,
      total_pipelines:  pipelines.length,
      total_notebooks:  items.filter(i => i.type === 'Notebook').length,
      total_models:     items.filter(i => i.type === 'SemanticModel').length,
      total_ml:         items.filter(i => ['MLModel','MLExperiment'].includes(i.type)).length,
    },
    generated_at: new Date().toISOString(),
  };
}

async function health(wsId) {
  const token = await getToken();
  const [wsRes, lhRes, plRes] = await Promise.all([
    get(`${BASE}/workspaces/${wsId}`, token),
    get(`${BASE}/workspaces/${wsId}/lakehouses`, token),
    get(`${BASE}/workspaces/${wsId}/dataPipelines`, token),
  ]);
  const now = Date.now();
  const lakehouses = (lhRes.body.value || []).map(lh => ({
    id: lh.id, name: lh.displayName,
    ultima_actualizacion: lh.modifiedDateTime || null,
    status: (() => {
      if (!lh.modifiedDateTime) return 'UNKNOWN';
      const h = (now - new Date(lh.modifiedDateTime).getTime()) / 3600000;
      return h < 24 ? 'OK' : h < 72 ? 'WARNING' : 'CRITICAL';
    })(),
  }));
  const pipelines = (plRes.body.value || []).map(p => ({ id: p.id, name: p.displayName }));
  return {
    workspace: { id: wsId, name: wsRes.body.displayName || wsId },
    lakehouses,
    pipelines,
    generated_at: new Date().toISOString(),
  };
}

async function runPipeline(wsId, pipelineId) {
  const token = await getToken();
  const res = await postJson(
    `${BASE}/workspaces/${wsId}/items/${pipelineId}/jobs/instances?jobType=Pipeline`,
    token, {}
  );
  return { accepted: res.status === 202, http_status: res.status, body: res.body };
}

async function getPipelineRuns(wsId, pipelineId) {
  const token = await getToken();
  const res = await get(`${BASE}/workspaces/${wsId}/items/${pipelineId}/jobs/instances`, token);
  const runs = (res.body.value || []).map(r => ({
    id: r.id,
    status: r.status,
    startTime: r.startTimeUtc || null,
    endTime: r.endTimeUtc || null,
    failureReason: r.failureReason || null,
  }));
  return { pipeline_id: pipelineId, runs, generated_at: new Date().toISOString() };
}

async function getLakehouseTables(wsId, lakehouseId) {
  const token = await getToken();
  const res = await get(`${BASE}/workspaces/${wsId}/lakehouses/${lakehouseId}/tables`, token);
  return {
    lakehouse_id: lakehouseId,
    tables: (res.body.value || []).map(t => ({
      name: t.name,
      type: t.type,
      format: t.format || null,
      location: t.location || null,
    })),
    generated_at: new Date().toISOString(),
  };
}

module.exports = { explore, health, runPipeline, getPipelineRuns, getLakehouseTables };
