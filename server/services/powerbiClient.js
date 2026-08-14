'use strict';
/**
 * powerbiClient.js
 * Proxy hacia la Power BI REST API usando las credenciales SP del .env.
 */
const { postForm, get, postJson } = require('./httpClient');

// ── Token con caché ───────────────────────────────────────────────────────────
let _token = null, _exp = 0;
async function getToken() {
  if (_token && Date.now() < _exp) return _token;
  const { AZURE_TENANT_ID: tid, AZURE_CLIENT_ID: cid, AZURE_CLIENT_SECRET: cs } = process.env;
  if (!tid || !cid || !cs) throw new Error('Faltan credenciales SP en .env');
  const res = await postForm(`https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`,
    { client_id: cid, client_secret: cs, scope: 'https://analysis.windows.net/powerbi/api/.default', grant_type: 'client_credentials' });
  if (!res.access_token) throw new Error('Token Power BI no obtenido: ' + JSON.stringify(res));
  _token = res.access_token;
  _exp = Date.now() + ((res.expires_in || 3600) - 300) * 1000;
  return _token;
}

const BASE = 'https://api.powerbi.com/v1.0/myorg/groups';

async function discover(wsId) {
  const token = await getToken();
  const [repRes, dsRes, dashRes] = await Promise.all([
    get(`${BASE}/${wsId}/reports`, token),
    get(`${BASE}/${wsId}/datasets`, token),
    get(`${BASE}/${wsId}/dashboards`, token),
  ]);
  return {
    workspace_id: wsId,
    reports:    (repRes.body.value  || []).map(r => ({ id: r.id, name: r.name, datasetId: r.datasetId, webUrl: r.webUrl })),
    datasets:   (dsRes.body.value   || []).map(d => ({ id: d.id, name: d.name, isRefreshable: d.isRefreshable })),
    dashboards: (dashRes.body.value || []).map(d => ({ id: d.id, name: d.displayName })),
    generated_at: new Date().toISOString(),
  };
}

async function getRefreshHistory(wsId, datasetId) {
  const token = await getToken();
  const res = await get(`${BASE}/${wsId}/datasets/${datasetId}/refreshes?$top=5`, token);
  return res.body.value || [];
}

async function triggerRefresh(wsId, datasetId) {
  const token = await getToken();
  const res = await postJson(
    `${BASE}/${wsId}/datasets/${datasetId}/refreshes`,
    token,
    { notifyOption: 'NoNotification' }
  );
  return { status: res.status, body: res.body };
}

async function executeDax(wsId, datasetId, daxQuery) {
  const token = await getToken();
  const res = await postJson(
    `${BASE}/${wsId}/datasets/${datasetId}/executeQueries`,
    token,
    { queries: [{ query: daxQuery }], serializerSettings: { includeNulls: true } }
  );
  return res;
}

async function getDataset(wsId, datasetId) {
  const token = await getToken();
  const res = await get(`${BASE}/${wsId}/datasets/${datasetId}`, token);
  return res.body;
}

module.exports = { discover, getRefreshHistory, triggerRefresh, executeDax, getDataset };
