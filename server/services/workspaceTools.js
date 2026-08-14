'use strict';

/**
 * workspaceTools — herramientas de sistema de archivos y utilidades del workspace local.
 *
 * Reemplaza las herramientas que VS Code Copilot provee nativamente:
 *   read/readFile        → workspace__readFile
 *   edit/createFile      → workspace__writeFile
 *   edit/createDirectory → workspace__createDirectory
 *   edit/rename          → workspace__renameFile
 *   search/listDirectory → workspace__listDirectory
 *   search/fileSearch    → workspace__fileSearch
 *   search/codebase      → workspace__textSearch
 *   search/textSearch    → workspace__textSearch
 *   web/fetch            → workspace__fetchUrl
 *
 * Todas las rutas se validan contra WORKSPACE_ROOT para prevenir path traversal.
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const https = require('https');
const http = require('http');
const { getSkillContent } = require('./agentReader');
const { generateExcel } = require('./excelGenerator');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../');
const MAX_READ_BYTES = 2 * 1024 * 1024; // archivos > 2 MB no se envían completos al LLM

/**
 * Resuelve una ruta relativa al workspace y valida que esté dentro de él.
 * Lanza error si la ruta intenta salir del workspace (path traversal).
 */
function safePath(relativePath) {
  // Limpiar separadores de Windows que el LLM a veces envía
  const clean = relativePath.replace(/\\/g, '/');
  const resolved = path.resolve(WORKSPACE_ROOT, clean);

  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Ruta no permitida fuera del workspace: ${relativePath}`);
  }
  return resolved;
}

/** Definiciones de las herramientas en formato OpenAI */
const WORKSPACE_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'workspace__readFile',
      description: 'Lee el contenido de un archivo dentro del workspace del proyecto.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa al workspace (ej. tests/HUs/1037/1037-final.json)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__writeFile',
      description: 'Crea o sobreescribe un archivo en el workspace. Crea los directorios intermedios automáticamente.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa al workspace donde guardar el archivo.' },
          content: { type: 'string', description: 'Contenido completo del archivo.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__createDirectory',
      description: 'Crea un directorio (y todos los intermedios) dentro del workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del directorio a crear.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__renameFile',
      description: 'Renombra o mueve un archivo o directorio dentro del workspace.',
      parameters: {
        type: 'object',
        properties: {
          oldPath: { type: 'string', description: 'Ruta relativa actual del archivo o directorio.' },
          newPath: { type: 'string', description: 'Nueva ruta relativa.' },
        },
        required: ['oldPath', 'newPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__listDirectory',
      description: 'Lista el contenido de un directorio dentro del workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del directorio a listar.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__fileSearch',
      description: 'Busca archivos por patrón glob dentro del workspace. Retorna rutas relativas de los archivos encontrados.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Patrón glob (ej. tests/HUs/**/*.json)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__textSearch',
      description: 'Busca texto dentro de archivos del workspace. Equivale a search/codebase y search/textSearch.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar.' },
          pattern: { type: 'string', description: 'Patrón glob de archivos donde buscar (opcional, por defecto **/*).' },
          maxResults: { type: 'number', description: 'Máximo de resultados (por defecto 20).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__fetchUrl',
      description: 'Descarga el contenido de una URL pública vía HTTP/HTTPS. Equivale a web/fetch.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL a descargar (http:// o https://).' },
          method: { type: 'string', description: 'Método HTTP (GET por defecto).' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace__loadSkill',
      description: 'Carga el contenido completo de una skill desde .github/skills/{skillName}/SKILL.md. Usa esto cuando necesites entender cómo ejecutar o usar una skill específica.',
      parameters: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: 'Nombre de la skill, ej. "json-to-markdown" o "user-story-invest-evaluator"' }
        },
        required: ['skillName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'workspace__generateExcel',
      description: 'Genera un archivo Excel (.xlsx) a partir de una lista de casos de prueba en formato JSON, compatible con Azure DevOps.',
      parameters: {
        type: 'object',
        properties: {
          outputPath: { type: 'string', description: 'Ruta relativa al workspace del archivo Excel a generar (ej. tests/Casos de prueba/273947/casos_prueba_HU_273947.xlsx)' },
          jsonContent: {
            type: 'object',
            properties: {
              casos_prueba: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    titulo: { type: 'string' },
                    area_path: { type: 'string' },
                    assigned_to: { type: 'string' },
                    state: { type: 'string' },
                    automation_status: { type: 'string' },
                    pasos: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          numero: { type: 'number' },
                          accion: { type: 'string' },
                          resultado_esperado: { type: 'string' }
                        },
                        required: ['numero', 'accion', 'resultado_esperado']
                      }
                    }
                  },
                  required: ['titulo', 'pasos']
                }
              }
            },
            required: ['casos_prueba']
          }
        },
        required: ['outputPath', 'jsonContent']
      }
    }
  }
];

/**
 * Ejecuta una herramienta workspace dado su nombre (sin el prefijo workspace__).
 * @param {string} toolName  - Nombre sin prefijo, ej. 'readFile'
 * @param {object} args
 * @returns {string}         - Resultado en texto plano
 */
function callWorkspaceTool(toolName, args) {
  switch (toolName) {
    case 'readFile': return readFile(args);
    case 'writeFile': return writeFile(args);
    case 'createDirectory': return createDirectory(args);
    case 'renameFile': return renameFile(args);
    case 'listDirectory': return listDirectory(args);
    case 'fileSearch': return fileSearch(args);
    case 'textSearch': return textSearch(args);
    case 'fetchUrl': return fetchUrl(args);
    case 'loadSkill': return loadSkill(args);
    case 'generateExcel': return generateExcelTool(args);
    default:
      throw new Error(`Herramienta workspace desconocida: ${toolName}`);
  }
}

// ── Implementaciones ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function readFile({ path: relativePath }) {
  const abs = safePath(relativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Archivo no encontrado: ${relativePath}`);
  }
  const { size } = fs.statSync(abs);
  if (size > MAX_READ_BYTES) {
    return `[Archivo demasiado grande (${(size / 1024 / 1024).toFixed(1)} MB). Usa textSearch para buscar contenido específico.]`;
  }
  return fs.readFileSync(abs, 'utf8');
}

function writeFile({ path: relativePath, content }) {
  const abs = safePath(relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  let safeContent = content;

  if (typeof content === 'object') {
    // Si manda un objeto, lo convertimos a JSON bonito
    safeContent = JSON.stringify(content, null, 2);
  } else if (typeof content === 'string') {
    // 1. Eliminar cualquier byte NUL (\x00) que corrompa el archivo en Windows
    safeContent = safeContent.replace(/\0/g, '');

    // 2. Si el string parece un JSON plano, lo parseamos y lo formateamos bonito
    const trimmed = safeContent.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        safeContent = JSON.stringify(parsed, null, 2);
      } catch (_) {
        // Si no es un JSON válido (ej. es un Markdown), se deja como texto normal
      }
    }
  } else {
    safeContent = String(content);
  }

  fs.writeFileSync(abs, safeContent, 'utf8');
  return `Archivo guardado correctamente: ${relativePath}`;
}

function createDirectory({ path: relativePath }) {
  const abs = safePath(relativePath);
  fs.mkdirSync(abs, { recursive: true });
  return `Directorio creado: ${relativePath}`;
}

function renameFile({ oldPath, newPath }) {
  const absOld = safePath(oldPath);
  const absNew = safePath(newPath);
  if (!fs.existsSync(absOld)) throw new Error(`No encontrado: ${oldPath}`);
  fs.mkdirSync(path.dirname(absNew), { recursive: true });
  fs.renameSync(absOld, absNew);
  return `Renombrado: ${oldPath} → ${newPath}`;
}

function listDirectory({ path: relativePath }) {
  const abs = safePath(relativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Directorio no encontrado: ${relativePath}`);
  }
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const lines = entries.map((e) => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`);
  return lines.join('\n') || '(directorio vacío)';
}

function fileSearch({ pattern }) {
  // Validar que el patrón no escape del workspace
  if (pattern.includes('..')) throw new Error('Patrón no permitido: contiene ".."');

  const matches = glob.sync(pattern, {
    cwd: WORKSPACE_ROOT,
    nodir: false,
    ignore: ['node_modules/**', '.git/**'],
  });
  return matches.length > 0
    ? matches.join('\n')
    : '(no se encontraron archivos)';
}

async function textSearch({ query, pattern = '**/*', maxResults = 20 }) {
  if (pattern.includes('..')) throw new Error('Patrón no permitido');

  const files = glob.sync(pattern, {
    cwd: WORKSPACE_ROOT,
    nodir: true,
    ignore: ['node_modules/**', '.git/**'],
  });

  const results = [];
  const lowerQ = query.toLowerCase();

  for (const rel of files) {
    if (results.length >= maxResults) break;
    const abs = path.join(WORKSPACE_ROOT, rel);
    try {
      const content = await fs.promises.readFile(abs, 'utf8');
      const lines = content.split('\n');
      for (let idx = 0; idx < lines.length && results.length < maxResults; idx++) {
        if (lines[idx].toLowerCase().includes(lowerQ)) {
          results.push(`${rel}:${idx + 1}: ${lines[idx].trim()}`);
        }
      }
    } catch (_) { /* archivo binario u otro error: ignorar */ }
  }

  return results.length > 0
    ? results.join('\n')
    : '(no se encontraron coincidencias)';
}

/**
 * Descarga el contenido de una URL pública.
 * Solo permite http y https; bloquea IPs privadas / localhost.
 */
function fetchUrl({ url, method = 'GET' }) {
  // Validar esquema
  if (!/^https?:\/\//i.test(url)) throw new Error('Solo se permiten URLs http/https.');

  // Bloquear IPs de red interna (SSRF básico).
  // localhost/127.0.0.1 se permite explícitamente porque los agentes de pruebas
  // necesitan acceder a la app en desarrollo (localhost:4200, localhost:8080, etc.).
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  // Bloquear rangos privados completos (RFC 1918) + link-local (AWS metadata) + IPv6 loopback
  const isPrivate =
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('169.254.') ||
    host === '::1' ||
    host === '0.0.0.0';
  if (isPrivate) {
    throw new Error('No se permiten URLs a IPs de red privada.');
  }

  const lib = url.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method, timeout: 15_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const truncated = body.length > 8000 ? body.substring(0, 8000) + '\n...[truncado]' : body;
        resolve(`HTTP ${res.statusCode}\n${truncated}`);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout en fetchUrl')); });
    req.end();
  });
}

/**
 * Carga una skill desde .github/skills/{skillName}/SKILL.md
 */
function loadSkill({ skillName }) {
  if (!skillName || typeof skillName !== 'string') {
    throw new Error('Se requiere el parámetro skillName (nombre de la skill).');
  }

  const content = getSkillContent(skillName.trim());
  if (!content) {
    throw new Error(`Skill no encontrada: "${skillName}". Usa skillNames disponibles.`);
  }

  return content;
}

/**
 * Genera un archivo Excel a partir de una lista de casos de prueba.
 */
async function generateExcelTool({ outputPath, jsonContent }) {
  if (!outputPath || typeof outputPath !== 'string') {
    throw new Error('Se requiere el parámetro outputPath.');
  }
  if (!jsonContent || typeof jsonContent !== 'object') {
    throw new Error('Se requiere el parámetro jsonContent.');
  }

  const absPath = safePath(outputPath);
  await generateExcel(absPath, jsonContent);
  return `Archivo Excel generado correctamente: ${outputPath}`;
}

module.exports = { WORKSPACE_TOOL_DEFS, callWorkspaceTool };
