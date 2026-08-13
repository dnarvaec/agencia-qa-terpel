/**
 * Wrapper para el servidor MCP de Azure DevOps.
 * Lee el PAT desde el archivo .env del workspace, lo codifica en base64
 * y lanza el servidor con la variable de entorno correcta.
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

let orgName = '';

if (envPath) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const cleanLine = line.replace(/\r$/, '');

        const patMatch = cleanLine.match(/^AZURE_DEVOPS_PAT=(.+)$/);
        if (patMatch) {
            const pat = patMatch[1].trim();
            process.env.PERSONAL_ACCESS_TOKEN = Buffer.from(':' + pat).toString('base64');
        }

        const orgMatch = cleanLine.match(/^AZURE_DEVOPS_ORG_URL=(.+)$/);
        if (orgMatch) {
            const orgUrl = orgMatch[1].trim();
            // Extrae el nombre de la org desde https://dev.azure.com/ORG_NAME/
            const urlMatch = orgUrl.match(/dev\.azure\.com\/([^/]+)/);
            if (urlMatch) {
                orgName = urlMatch[1];
            }
        }
    }
}

if (!process.env.PERSONAL_ACCESS_TOKEN) {
    process.stderr.write('ERROR: No se encontró AZURE_DEVOPS_PAT en el archivo .env\n');
    process.stderr.write('cwd: ' + process.cwd() + '\n');
    process.stderr.write('__dirname: ' + __dirname + '\n');
    process.stderr.write('Rutas buscadas:\n' + candidatePaths.join('\n') + '\n');
    process.exit(1);
}

if (!orgName) {
    process.stderr.write('ERROR: No se encontró AZURE_DEVOPS_ORG_URL en el archivo .env\n');
    process.exit(1);
}

const child = spawn(
    'npx',
    ['-y', '@azure-devops/mcp', orgName, '--authentication', 'pat'],
    { stdio: 'inherit', env: process.env, shell: true }
);

child.on('exit', (code) => process.exit(code ?? 0));
