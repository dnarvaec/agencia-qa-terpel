'use strict';

/**
 * Cliente MCP sobre transporte stdio (JSON-RPC 2.0 line-delimited).
 * Gestiona una conexión a un servidor MCP externo lanzado como subproceso.
 */

const { spawn }   = require('child_process');
const readline    = require('readline');

const REQUEST_TIMEOUT_MS = 45_000;

/** Registro global de todos los clientes activos — usado por stopAll() */
const _allClients = new Set();

class MCPClient {
  /**
   * @param {string}   name    - Nombre lógico del servidor (ej. 'playwright')
   * @param {string}   command - Ejecutable
   * @param {string[]} args    - Argumentos del ejecutable
   * @param {string}   cwd    - Directorio de trabajo
   * @param {object}   [env]  - Variables de entorno adicionales para el proceso
   */
  constructor(name, command, args, cwd, env) {
    this.name    = name;
    this.command = command;
    this.args    = args;
    this.cwd     = cwd;
    this.env     = env || {};

    this.process = null;
    this.pending = new Map(); // id → { resolve, reject, timer }
    this.nextId  = 1;
    this.tools   = [];
    this.ready   = false;
  }

  // ── Ciclo de vida ───────────────────────────────────────────────────────────

  start() {
    return new Promise((resolve, reject) => {
      // En Windows los scripts .cmd/.bat necesitan shell:true para poder ejecutarse.
      // Con shell:true, el proceso corre bajo cmd.exe por lo que 'npx', 'node', etc.
      // se resuelven correctamente por PATH sin necesidad de la extensión .cmd.
      const useShell = process.platform === 'win32';

      this.process = spawn(this.command, this.args, {
        cwd:        this.cwd,
        env:        { ...process.env, ...this.env },
        stdio:      ['pipe', 'pipe', 'pipe'],
        shell:      useShell,
        detached:   false, // permanece en el mismo job object del padre (Windows)
        killSignal: 'SIGKILL',
      });

      _allClients.add(this); // registrar para limpieza global

      // Leer stdout línea a línea (NDJSON)
      const rl = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          this._handleMessage(JSON.parse(line));
        } catch (_) { /* ignorar líneas no-JSON */ }
      });

      // Loguear stderr sin fallar (los servidores MCP usan stderr para info)
      this.process.stderr.on('data', (chunk) => {
        process.stderr.write(`[MCP:${this.name}] ${chunk}`);
      });

      this.process.on('error', (err) => {
        if (!this.ready) reject(err);
      });

      this.process.on('close', (code) => {
        this.ready = false;
        _allClients.delete(this); // ya no está activo
        for (const { reject: rej, timer } of this.pending.values()) {
          clearTimeout(timer);
          rej(new Error(`MCP '${this.name}' cerrado (código ${code})`));
        }
        this.pending.clear();
      });

      // Esperar un momento y luego inicializar el handshake MCP
      setTimeout(() => {
        this._initialize().then(() => resolve(this)).catch(reject);
      }, 800);
    });
  }

  stop() {
    _allClients.delete(this);
    if (this.process && !this.process.killed) {
      try { this.process.kill('SIGKILL'); } catch (_) { /* proceso ya muerto */ }
    }
  }

  /**
   * Mata todos los procesos MCP activos — llamar en SIGINT/SIGTERM del servidor.
   */
  static stopAll() {
    for (const client of [..._allClients]) {
      client.stop();
    }
    _allClients.clear();
  }

  // ── Protocolo MCP ───────────────────────────────────────────────────────────

  async _initialize() {
    await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    { tools: {} },
      clientInfo:      { name: 'agent-ui', version: '1.0.0' },
    });

    // Notificación sin id (no espera respuesta)
    this._notify('notifications/initialized', {});

    const result  = await this._request('tools/list', {});
    this.tools    = (result && result.tools) ? result.tools : [];
    this.ready    = true;
  }

  _handleMessage(msg) {
    if (msg.id === undefined) return; // notificación del servidor

    const entry = this.pending.get(msg.id);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    } else {
      entry.resolve(msg.result);
    }
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id      = this.nextId++;
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout (${REQUEST_TIMEOUT_MS / 1000}s) en MCP '${this.name}' → ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(payload);
    });
  }

  _notify(method, params) {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(payload);
  }

  // ── API pública ─────────────────────────────────────────────────────────────

  /**
   * Invoca una herramienta MCP y devuelve el resultado.
   * @param {string} toolName - Nombre exacto de la herramienta
   * @param {object} args     - Argumentos de la herramienta
   */
  callTool(toolName, args) {
    if (!this.ready) throw new Error(`MCP '${this.name}' no está listo`);
    return this._request('tools/call', { name: toolName, arguments: args });
  }
}

module.exports = MCPClient;
