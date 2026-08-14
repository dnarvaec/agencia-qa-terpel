'use strict';

const https = require('https');

async function getWorkItemById({ id, project, fields, expand, asOf }) {
  if (!id) throw new Error('El id del Work Item es obligatorio.');
  if (!project) throw new Error('El project de Azure DevOps es obligatorio.');

  const pat    = process.env.AZURE_DEVOPS_PAT;
  const orgUrl = (process.env.AZURE_DEVOPS_ORG_URL || '').replace(/\/$/, '');

  if (!pat)    throw new Error('AZURE_DEVOPS_PAT no está definido en .env');
  if (!orgUrl) throw new Error('AZURE_DEVOPS_ORG_URL no está definido en .env');

  // PAT codificado en base64 como ':PAT' — formato estándar de Basic auth de Azure DevOps
  const token = Buffer.from(`:${pat}`).toString('base64');

  const params = new URLSearchParams({ 'api-version': '7.1' });
  if (Array.isArray(fields) && fields.length > 0) params.set('fields', fields.join(','));
  if (expand) params.set('$expand', expand);
  if (asOf)   params.set('asOf', asOf);

  const url = new URL(
    `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(id)}?${params}`
  );

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   'GET',
        headers: {
          'Authorization': `Basic ${token}`,
          'Content-Type':  'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (d) => body += d);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Azure DevOps REST respondió ${res.statusCode}: ${body.substring(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Respuesta REST no es JSON válido: ${body.substring(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = { getWorkItemById };

