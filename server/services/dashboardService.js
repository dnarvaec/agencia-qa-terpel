'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Escanea y agrega métricas de los casos de prueba y reportes del workspace,
 * agrupándolos tanto a nivel global como por cada HU individual.
 */
function getDashboardData() {
  const rootDir = path.join(__dirname, '../..');

  const hus = {};

  const getHuObject = (huId) => {
    if (!hus[huId]) {
      hus[huId] = {
        huId: huId,
        totalCases: 0,
        statusCounts: { Designed: 0, Executed: 0, Completed: 0 },
        automationCounts: { Automated: 0, NotAutomated: 0 },
        bugs: []
      };
    }
    return hus[huId];
  };

  // Helper para procesar archivos JSON de casos de prueba
  const scanJsonFile = (filePath, huId) => {
    try {
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);

      let cases = [];
      if (Array.isArray(parsed)) {
        cases = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.casos_prueba)) {
          cases = parsed.casos_prueba;
        } else if (Array.isArray(parsed.casos)) {
          cases = parsed.casos;
        } else if (Array.isArray(parsed.testCases)) {
          cases = parsed.testCases;
        } else if (Array.isArray(parsed.test_cases)) {
          cases = parsed.test_cases;
        }
      }

      if (cases && cases.length > 0) {
        const hu = getHuObject(huId);
        hu.totalCases += cases.length;

        cases.forEach(tc => {
          if (!tc) return;

          // 1. Estado (state/status)
          const state = String(tc.state || tc.status || 'Design').toLowerCase();
          if (state.includes('design') || state.includes('diseñ')) {
            hu.statusCounts.Designed++;
          } else if (state.includes('exec') || state.includes('ejecut')) {
            hu.statusCounts.Executed++;
          } else if (state.includes('complete') || state.includes('complet')) {
            hu.statusCounts.Completed++;
          } else {
            hu.statusCounts.Designed++;
          }

          // 2. Automatización (automation_status/automationStatus)
          const auto = String(tc.automation_status || tc.automationStatus || 'Not Automated').toLowerCase();
          if (auto.includes('not') || auto.includes('no')) {
            hu.automationCounts.NotAutomated++;
          } else if (auto.includes('auto')) {
            hu.automationCounts.Automated++;
          } else {
            hu.automationCounts.NotAutomated++;
          }
        });
      }
    } catch (e) {
      console.error(`Error procesando archivo de casos ${filePath}:`, e.message);
    }
  };

  // 1. Escanear archivos/HUs
  const husDir = path.join(rootDir, 'archivos/HUs');
  if (fs.existsSync(husDir)) {
    try {
      const folders = fs.readdirSync(husDir);
      folders.forEach(hu => {
        const huPath = path.join(husDir, hu);
        if (fs.statSync(huPath).isDirectory()) {
          // Buscar en subcarpeta casos_prueba
          const subcasos = path.join(huPath, 'casos_prueba');
          if (fs.existsSync(subcasos) && fs.statSync(subcasos).isDirectory()) {
            fs.readdirSync(subcasos).forEach(f => {
              if (f.endsWith('.json')) {
                scanJsonFile(path.join(subcasos, f), hu);
              }
            });
          }
          // Buscar directamente en la carpeta de la HU (excluyendo archivos -final.json que son la HU cruda)
          fs.readdirSync(huPath).forEach(f => {
            if (f.endsWith('.json') && !f.endsWith('-final.json')) {
              scanJsonFile(path.join(huPath, f), hu);
            }
          });
        }
      });
    } catch (e) {
      console.error('Error escaneando archivos/HUs:', e.message);
    }
  }

  // 2. Escanear archivos/Casos de Prueba
  const casosDir = path.join(rootDir, 'archivos/Casos de Prueba');
  if (fs.existsSync(casosDir)) {
    try {
      const subfolders = fs.readdirSync(casosDir);
      subfolders.forEach(sub => {
        const subPath = path.join(casosDir, sub);
        if (fs.statSync(subPath).isDirectory()) {
          fs.readdirSync(subPath).forEach(f => {
            if (f.endsWith('.json')) {
              scanJsonFile(path.join(subPath, f), sub);
            }
          });
        }
      });
    } catch (e) {
      console.error('Error escaneando archivos/Casos de Prueba:', e.message);
    }
  }

  // 3. Escanear bugs/defectos en archivos/Seguimiento
  const allBugs = [];
  const seguimientoDir = path.join(rootDir, 'archivos/Seguimiento');
  if (fs.existsSync(seguimientoDir)) {
    try {
      const rpts = fs.readdirSync(seguimientoDir);
      rpts.forEach(rpt => {
        const rptPath = path.join(seguimientoDir, rpt);
        if (fs.statSync(rptPath).isDirectory()) {
          fs.readdirSync(rptPath).forEach(f => {
            if (f.endsWith('-dashboard.json')) {
              try {
                const content = fs.readFileSync(path.join(rptPath, f), 'utf8');
                const parsed = JSON.parse(content);
                if (parsed.defectos && Array.isArray(parsed.defectos.detalle)) {
                  parsed.defectos.detalle.forEach(bug => {
                    if (!bug) return;
                    if (!allBugs.some(b => String(b.id) === String(bug.id))) {
                      allBugs.push({
                        id: bug.id || String(Math.random()).substring(2, 6),
                        titulo: bug.titulo || 'Defecto sin título',
                        estado: bug.estado || 'Nuevo',
                        prioridad: bug.prioridad || 'Medio',
                        modulo: bug.modulo || 'General',
                        fecha: bug.fecha_creacion || parsed.generated_at || ''
                      });
                    }
                  });
                }
              } catch (e) {}
            } else if (f.endsWith('-qa-results.json')) {
              try {
                const content = fs.readFileSync(path.join(rptPath, f), 'utf8');
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed.results)) {
                  parsed.results.forEach(res => {
                    if (!res) return;
                    if (res.status === 'FAIL' || res.error_type === 'system_bug') {
                      const bugTitle = res.error || res.title || 'Error detectado';
                      if (!allBugs.some(b => b.titulo === bugTitle)) {
                        allBugs.push({
                          id: res.id || String(Math.random()).substring(2, 6),
                          titulo: res.title || bugTitle,
                          estado: 'Activo',
                          prioridad: res.priority || 'Alto',
                          modulo: res.subtype || 'API',
                          fecha: parsed.generated_at || '',
                          storyId: parsed.story_id
                        });
                      }
                    }
                  });
                }
              } catch (e) {}
            }
          });
        }
      });
    } catch (e) {
      console.error('Error escaneando tests/Seguimiento:', e.message);
    }
  }

  // Asociar cada bug a la HU correspondiente
  const huIds = Object.keys(hus);
  const defaultHuId = huIds[0] || 'General';

  allBugs.forEach(bug => {
    let matchedHuId = bug.storyId;
    if (!matchedHuId) {
      // Buscar en título, módulo o descripción si coincide con el ID de alguna HU
      const text = `${bug.titulo} ${bug.modulo}`.toLowerCase();
      const found = huIds.find(id => text.includes(id));
      matchedHuId = found || defaultHuId;
    }

    if (matchedHuId) {
      const hu = getHuObject(matchedHuId);
      if (!hu.bugs.some(b => String(b.id) === String(bug.id))) {
        hu.bugs.push(bug);
      }
    }
  });

  // Consolidar global
  const global = {
    totalCases: 0,
    statusCounts: { Designed: 0, Executed: 0, Completed: 0 },
    automationCounts: { Automated: 0, NotAutomated: 0 },
    totalBugs: allBugs.length,
    bugs: allBugs
  };

  huIds.forEach(id => {
    const hu = hus[id];
    global.totalCases += hu.totalCases;
    global.statusCounts.Designed += hu.statusCounts.Designed;
    global.statusCounts.Executed += hu.statusCounts.Executed;
    global.statusCounts.Completed += hu.statusCounts.Completed;
    global.automationCounts.Automated += hu.automationCounts.Automated;
    global.automationCounts.NotAutomated += hu.automationCounts.NotAutomated;
  });

  return {
    global,
    hus
  };
}

module.exports = { getDashboardData, parseMarkdownHU };

function parseMarkdownHU(mdContent) {
  const hu = {
    story_id: '', story_title: '', story_description: '',
    acceptance_criteria: [], score_initial: 0, score_final: 0,
    iterations_count: 1, key_improvements: ''
  };

  const titleMatch = mdContent.match(/^##\s+(.+)$/m);
  if (titleMatch) hu.story_title = titleMatch[1].trim();

  const idMatch = mdContent.match(/### Story ID\r?\n(\d+)/i);
  if (idMatch) hu.story_id = idMatch[1].trim();

  const descStart = mdContent.indexOf('### Descripción');
  if (descStart !== -1) {
    const next = mdContent.indexOf('###', descStart + 15);
    hu.story_description = mdContent.substring(descStart + 15, next !== -1 ? next : mdContent.length).trim();
  }

  const caStart = mdContent.indexOf('### Criterios de Aceptación');
  if (caStart !== -1) {
    const next = mdContent.indexOf('###', caStart + 27);
    mdContent.substring(caStart + 27, next !== -1 ? next : mdContent.length).trim()
      .split('\n')
      .forEach(line => {
        const clean = line.replace(/^\d+\.\s+/, '').replace(/^-\s+/, '').trim();
        if (clean) hu.acceptance_criteria.push(clean);
      });
  }

  const m = (re) => { const r = mdContent.match(re); return r ? parseInt(r[1], 10) : undefined; };
  hu.score_initial   = m(/\*\*Score Inicial:\*\*\s*(\d+)/i) ?? 0;
  hu.score_final     = m(/\*\*Score Final:\*\*\s*(\d+)/i)   ?? 0;
  hu.iterations_count = m(/\*\*Iteraciones:\*\*\s*(\d+)/i)  ?? 1;
  const improv = mdContent.match(/\*\*Cambios Principales:\*\*\s*(.+)/i);
  if (improv) hu.key_improvements = improv[1].trim();

  return hu;
}
