'use strict';
const https = require('https');

/** Helpers HTTP compartidos entre fabricClient y powerbiClient. */

function postForm(url, body) {
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

module.exports = { postForm, get, postJson };
