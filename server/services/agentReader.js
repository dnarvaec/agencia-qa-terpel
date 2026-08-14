'use strict';

const fs   = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '../../.github/agents');
const SKILLS_DIR = path.join(__dirname, '../../.github/skills');

/**
 * Extrae el bloque YAML frontmatter y el contenido Markdown de un .agent.md
 */
function parseFrontmatter(raw) {
  // strip UTF-8 BOM (\uFEFF) that some editors add silently
  const match = raw.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const yaml     = match[1];
  const markdown = match[2];

  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);
  const hiddenMatch = yaml.match(/^hidden:\s*(true|false)$/m);
  const hidden = hiddenMatch ? hiddenMatch[1] === 'true' : false;

  // El array de tools puede estar en formato: tools: [ item1, item2, ... ]
  // con saltos de línea e indentación opcionales.
  const toolsBlock = yaml.match(/tools:\s*\[([\s\S]*?)\]/);
  const tools = toolsBlock
    ? toolsBlock[1]
        .split(',')
        .map((t) => t.replace(/[\r\n]/g, '').trim())
        .filter(Boolean)
    : [];

  return {
    name:         nameMatch ? nameMatch[1].trim() : '',
    description:  descMatch ? descMatch[1].trim() : '',
    hidden,
    tools,
    systemPrompt: resolveEnvVars(markdown.trim()),
  };
}

/**
 * Resuelve referencias ${env:VARIABLE_NAME} usando process.env.
 * Las variables no definidas se dejan sin cambio para facilitar el debug.
 */
function resolveEnvVars(text) {
  return text.replace(/\$\{env:([A-Z0-9_]+)\}/g, (match, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      console.warn(`[agentReader] Variable de entorno no definida: ${varName}`);
      return match; // dejar literal para visibilidad
    }
    return value;
  });
}

let _agentsCache = null;
let _agentsCacheAt = 0;
const AGENTS_CACHE_TTL_MS = 30_000;

let _skillsCache = null;
let _skillsCacheAt = 0;
const SKILLS_CACHE_TTL_MS = 30_000;

/**
 * Devuelve todos los agentes definidos en .github/agents/*.agent.md
 */
function getAgents() {
  const now = Date.now();
  if (_agentsCache && now - _agentsCacheAt < AGENTS_CACHE_TTL_MS) return _agentsCache;

  if (!fs.existsSync(AGENTS_DIR)) return [];

  _agentsCache = fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.agent.md'))
    .map((f) => {
      const filePath = path.join(AGENTS_DIR, f);
      const raw      = fs.readFileSync(filePath, 'utf8');
      const parsed   = parseFrontmatter(raw);
      if (!parsed) return null;
      const agent = { id: path.basename(f, '.agent.md'), filePath, ...parsed };
      // fullText precalculado para evitar recompute en cada ejecución del agente
      agent.fullText = ((parsed.systemPrompt || '') + ' ' + (parsed.description || '')).toLowerCase();
      return agent;
    })
    .filter((a) => a && !a.hidden);

  _agentsCacheAt = now;
  return _agentsCache;
}

/**
 * Busca un agente por id o por name (case-insensitive)
 */
function getAgent(agentIdOrName) {
  return getAgents().find(
    (a) =>
      a.id   === agentIdOrName ||
      a.name === agentIdOrName ||
      a.id.toLowerCase()   === agentIdOrName.toLowerCase() ||
      a.name.toLowerCase() === agentIdOrName.toLowerCase()
  );
}

/**
 * Devuelve todas las skills disponibles en .github/skills/<skillName>/SKILL.md
 */
function getSkills() {
  const now = Date.now();
  if (_skillsCache && now - _skillsCacheAt < SKILLS_CACHE_TTL_MS) return _skillsCache;

  if (!fs.existsSync(SKILLS_DIR)) return [];

  _skillsCache = fs
    .readdirSync(SKILLS_DIR)
    .filter((d) => {
      const fullPath = path.join(SKILLS_DIR, d);
      return fs.statSync(fullPath).isDirectory();
    })
    .map((skillFolder) => {
      const skillFile = path.join(SKILLS_DIR, skillFolder, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return null;

      const raw = fs.readFileSync(skillFile, 'utf8');
      const parsed = parseFrontmatter(raw);
      if (!parsed) return null;

      return {
        id: skillFolder,
        name: parsed.name || skillFolder,
        description: parsed.description || '',
        filePath: skillFile,
        content: raw,
      };
    })
    .filter(Boolean);

  _skillsCacheAt = now;
  return _skillsCache;
}

/**
 * Busca una skill por nombre (case-insensitive)
 */
function getSkill(skillName) {
  return getSkills().find(
    (s) =>
      s.id.toLowerCase() === skillName.toLowerCase() ||
      s.name.toLowerCase() === skillName.toLowerCase()
  );
}

/**
 * Retorna el contenido completo (YAML + Markdown) de una skill
 */
function getSkillContent(skillName) {
  const skill = getSkill(skillName);
  return skill ? skill.content : null;
}

module.exports = { getAgents, getAgent, getSkills, getSkill, getSkillContent };
