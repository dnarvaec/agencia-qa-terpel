'use strict';

const { spawnSync } = require('child_process');

function escapeForPowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(script) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  if (result.error) {
    throw result.error;
  }

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();

  if (result.status !== 0) {
    throw new Error(stdout || stderr || `PowerShell finalizó con código ${result.status}.`);
  }

  return stdout;
}

async function getWorkItemById({ id, project, fields, expand, asOf }) {
  if (!id) {
    throw new Error('El id del Work Item es obligatorio.');
  }
  if (!project) {
    throw new Error('El project de Azure DevOps es obligatorio.');
  }

  const extraQueryParts = [];
  if (Array.isArray(fields) && fields.length > 0) {
    extraQueryParts.push(`fields=${fields.join(',')}`);
  }
  if (expand) {
    extraQueryParts.push(`$expand=${expand}`);
  }
  if (asOf) {
    extraQueryParts.push(`asOf=${asOf}`);
  }

  const script = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$envText = Get-Content .env -Raw
if ($envText -match 'AZURE_DEVOPS_PAT=(.+)') { $pat = $Matches[1].Trim().Trim('"''') }
if ($envText -match 'AZURE_DEVOPS_ORG_URL=(.+)') { $org = $Matches[1].Trim().Trim('"''').TrimEnd('/') }
$proj = '${escapeForPowerShellSingleQuoted(project)}'
$id = '${escapeForPowerShellSingleQuoted(id)}'
$url = "$org/$proj/_apis/wit/workitems/${id}?api-version=7.1"
if ('${escapeForPowerShellSingleQuoted(extraQueryParts.join('&'))}') {
  $url = $url + '&' + '${escapeForPowerShellSingleQuoted(extraQueryParts.join('&'))}'
}
try {
  $response = Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $pat" } -UseBasicParsing
  $response.Content
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode.value__
    throw ("Azure DevOps REST respondió " + $status + ": " + $_.Exception.Message)
  }
  throw $_.Exception.Message
}
`.trim();

  const output = runPowerShell(script);

  try {
    return JSON.parse(output);
  } catch (err) {
    throw new Error(`No fue posible interpretar la respuesta REST como JSON: ${output.substring(0, 500)}`);
  }
}

module.exports = {
  getWorkItemById,
};
