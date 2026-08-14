'use strict';

/**
 * MCPManager: orquesta múltiples clientes MCP según los servidores declarados
 * en .vscode/mcp.json y las herramientas que necesita cada agente.
 */

const path      = require('path');
const MCPClient = require('./mcpClient');
const { getWorkItemById } = require('./azureDevopsRestClient');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../');

/** Configuración equivalente a .vscode/mcp.json */
// Nota: el soporte Windows (shell:true) se maneja en mcpClient.js,
// por lo que aquí se usan siempre los nombres cortos de los comandos.
const MCP_SERVER_CONFIGS = {
  'azure-devops': {
    command: 'node',
    args:    ['.vscode/start-azure-devops-mcp.js'],
    cwd:     WORKSPACE_ROOT,
  },
  'playwright': {
    command: 'npx',
    args:    ['@playwright/mcp@latest'],
    cwd:     WORKSPACE_ROOT,
  },
};

/**
 * Detecta qué servidores MCP necesita un agente según su lista de herramientas.
 */
function detectNeededServers(agentTools) {
  const needed = new Set();
  const unknown = new Set();
  for (const tool of agentTools) {
    const prefix = tool.split('/')[0];
    if (MCP_SERVER_CONFIGS[prefix]) {
      needed.add(prefix);
    } else if (!['read', 'edit', 'search', 'web', 'execute'].includes(prefix)) {
      unknown.add(prefix);
    }
  }
  if (unknown.size > 0) {
    console.warn(`[MCPManager] ⚠️  Prefijos MCP sin configuración (se ignorarán): ${[...unknown].join(', ')}`);
  }
  console.log(`[MCPManager] Servidores MCP detectados para este agente: ${needed.size > 0 ? [...needed].join(', ') : 'ninguno'}`);
  return needed;
}

function isAzureDevOpsWorkItemGet(openaiToolName, args) {
  return openaiToolName === 'azure_devops__wit_work_item'
    && !!args
    && String(args.action || '').toLowerCase() === 'get';
}

function shouldFallbackToAzureDevOpsRest(openaiToolName, args, err) {
  if (!isAzureDevOpsWorkItemGet(openaiToolName, args)) return false;

  const message = String(err?.message || '');
  return /401|403|Failed request/i.test(message);
}

function shouldFallbackFromMcpResult(openaiToolName, args, result) {
  if (!isAzureDevOpsWorkItemGet(openaiToolName, args)) return false;
  if (!result || !result.isError) return false;

  const text = Array.isArray(result.content)
    ? result.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text || '')
      .join('\n')
    : '';

  return /401|403|Failed request/i.test(text);
}

function buildRestFallbackResult(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError: false,
    _fallback: 'azure-devops-rest',
  };
}

async function executeAzureDevOpsRestFallback(openaiToolName, args) {
  const fallbackProject = args.project || process.env.AZURE_DEVOPS_PROJECT;
  console.warn(`[MCPManager] ⚠️  ${openaiToolName} activando fallback REST para Work Item ${args.id} en proyecto ${fallbackProject}.`);
  const data = await getWorkItemById({
    id: args.id,
    project: fallbackProject,
    fields: args.fields,
    expand: args.expand,
    asOf: args.as_of || args.asOf,
  });
  const fallbackResult = buildRestFallbackResult(data);
  console.log(`[MCPManager] ← ${openaiToolName} [fallback-rest]: ${JSON.stringify(fallbackResult).substring(0, 300)}`);
  return fallbackResult;
}

class MCPManager {
  constructor() {
    /** @type {Map<string, MCPClient>} */
    this.clients = new Map();
  }

  /**
   * Arranca los servidores MCP que necesita el agente.
   * @param {object}   agent
   * @param {function} onProgress
   */
  async initializeForAgent(agent, onProgress) {
    const needed = detectNeededServers(agent.tools);

    if (needed.size === 0) {
      onProgress({ type: 'info', message: 'ℹ️  Este agente no requiere servidores MCP locales.' });
      return;
    }

    for (const serverName of needed) {
      const cfg = MCP_SERVER_CONFIGS[serverName];

      console.log(`[MCPManager] Iniciando servidor MCP: ${serverName} → ${cfg.command} ${cfg.args.join(' ')}`);
      onProgress({ type: 'mcp', message: `⚙️  Iniciando servidor MCP: ${serverName}...` });

      const client = new MCPClient(serverName, cfg.command, cfg.args, cfg.cwd, cfg.env || {});
      try {
        await client.start();
        this.clients.set(serverName, client);
        console.log(`[MCPManager] ✅ MCP '${serverName}' listo — ${client.tools.length} herramientas`);
        onProgress({
          type:    'mcp-ready',
          message: `✅ MCP '${serverName}' listo — ${client.tools.length} herramientas disponibles`,
        });
      } catch (err) {
        console.error(`[MCPManager] ❌ MCP '${serverName}' FALLÓ: ${err.message}`);
        if (err.stack) console.error(err.stack);
        onProgress({
          type:    'warning',
          message: `⚠️  MCP '${serverName}' no disponible: ${err.message}`,
        });
      }
    }
  }

  /** Devuelve los tools de un servidor específico */
  getServerTools(serverName) {
    const client =
      this.clients.get(serverName) ||
      this.clients.get(serverName.replace(/-/g, '_'));
    return client ? client.tools : [];
  }

  /** Devuelve todos los tools de todos los servidores activos */
  getAllTools() {
    const tools = [];
    for (const [serverName, client] of this.clients) {
      for (const tool of client.tools) {
        tools.push({ serverName, tool });
      }
    }
    return tools;
  }

  /**
   * Convierte los tools MCP al formato que espera la API de OpenAI.
   * Nombre OpenAI: {server_normalizado}__{tool_name}  (máx. 64 chars)
   * Ejemplo: azure_devops__wit_get_work_item
   *
   * @param {string[]} [agentTools]  Lista de tools declaradas en el YAML del agente
   *                                 (ej. ['azure-devops/wit_get_work_item', ...]).
   *                                 Si se proporciona, solo se incluyen las que coincidan.
   */
  toOpenAITools(agentTools) {
    // Construir un Set de nombres en formato "server/tool_name" para filtrar rápido.
    // Si no se pasa lista, se devuelven TODAS (comportamiento anterior).
    const allowedSet = agentTools && agentTools.length > 0
      ? new Set(agentTools.map((t) => t.toLowerCase()))
      : null;

    return this.getAllTools()
      .filter(({ serverName, tool }) => {
        if (!allowedSet) return true;
        // El YAML usa "azure-devops/wit_get_work_item" y el servidor MCP usa "wit_get_work_item"
        const key = `${serverName}/${tool.name}`.toLowerCase();
        return allowedSet.has(key);
      })
      .map(({ serverName, tool }) => {
        const serverKey  = serverName.replace(/-/g, '_');
        const openaiName = `${serverKey}__${tool.name}`.substring(0, 64);

        return {
          type: 'function',
          function: {
            name:        openaiName,
            description: (tool.description || tool.name).substring(0, 1024),
            parameters:  tool.inputSchema || { type: 'object', properties: {} },
          },
        };
      });
  }

  /**
   * Ejecuta un tool dado el nombre en formato OpenAI (server__toolName).
   * @param {string} openaiToolName - Ej. "playwright__browser_navigate"
   * @param {object} args
   */
  async callTool(openaiToolName, args) {
    const sep = openaiToolName.indexOf('__');
    if (sep === -1) throw new Error(`Formato de herramienta inválido: ${openaiToolName}`);

    // Recuperar el nombre original del servidor (con guiones)
    const serverKey  = openaiToolName.substring(0, sep).replace(/_/g, '-');
    const toolName   = openaiToolName.substring(sep + 2);

    // El servidor podría tener nombre exacto o normalizado; buscar ambos
    const client =
      this.clients.get(serverKey) ||
      this.clients.get(serverKey.replace(/-/g, '_'));

    if (!client) {
      console.error(`[MCPManager] ❌ callTool: servidor '${serverKey}' no está activo. Clientes activos: [${[...this.clients.keys()].join(', ')}]`);
      throw new Error(`Servidor MCP '${serverKey}' no está disponible en esta ejecución.`);
    }

    console.log(`[MCPManager] → ${openaiToolName}(${JSON.stringify(args).substring(0, 200)})`);
    try {
      const result = await client.callTool(toolName, args);
      if (shouldFallbackFromMcpResult(openaiToolName, args, result)) {
        return await executeAzureDevOpsRestFallback(openaiToolName, args);
      }

      console.log(`[MCPManager] ← ${openaiToolName}: ${JSON.stringify(result).substring(0, 300)}`);
      return result;
    } catch (err) {
      if (shouldFallbackToAzureDevOpsRest(openaiToolName, args, err)) {
        try {
          return await executeAzureDevOpsRestFallback(openaiToolName, args);
        } catch (fallbackErr) {
          console.error(`[MCPManager] ❌ Fallback REST ${openaiToolName} ERROR: ${fallbackErr.message}`);
          throw fallbackErr;
        }
      }

      console.error(`[MCPManager] ❌ ${openaiToolName} ERROR: ${err.message}`);
      throw err;
    }
  }

  async cleanup() {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }
}

module.exports = MCPManager;
