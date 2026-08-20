/**
 * Wrapper para el servidor MCP de Jira (mcp-atlassian).
 * Lee las credenciales desde el archivo .env del workspace y lanza
 * el servidor via `uvx mcp-atlassian` con las variables de entorno correctas.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Busca el .env desde el cwd (workspaceFolder) y como fallback desde __dirname
const candidatePaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
];

const envPath = candidatePaths.find(p => fs.existsSync(p));

const vars = {};
if (envPath) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const cleanLine = line.replace(/\r$/, '');
        const match = cleanLine.match(/^(JIRA_[A-Z_]+)=(.*)$/);
        if (match) vars[match[1]] = match[2].trim();
    }
}

if (!vars.JIRA_URL) {
    process.stderr.write('ERROR: No se encontró JIRA_URL en el archivo .env\n');
    process.exit(1);
}

// Server/Data Center: PAT (bearer) o Basic Auth (usuario + API token)
const hasPat = !!vars.JIRA_PERSONAL_TOKEN;
const hasBasicAuth = !!vars.JIRA_USERNAME && !!vars.JIRA_API_TOKEN;
if (!hasPat && !hasBasicAuth) {
    process.stderr.write('ERROR: Define JIRA_PERSONAL_TOKEN o (JIRA_USERNAME + JIRA_API_TOKEN) en el archivo .env\n');
    process.exit(1);
}

// Resuelve uvx sin depender del PATH heredado por VS Code al arrancar
// (evita fallos justo despues de instalar uv, antes de reiniciar el editor)
const uvxCandidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'uvx.exe'),
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'uvx.exe'),
    'uvx',
];
const uvxCmd = uvxCandidates.find(p => p === 'uvx' || fs.existsSync(p));

const child = spawn(
    uvxCmd,
    ['mcp-atlassian'],
    { stdio: 'inherit', env: { ...process.env, ...vars }, shell: true }
);

child.on('exit', (code) => process.exit(code ?? 0));
