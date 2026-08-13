'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

/**
 * Genera un archivo Excel a partir del JSON de casos de prueba.
 * 
 * @param {string} absOutputPath - Ruta absoluta de salida
 * @param {object} jsonContent - Objeto con { casos_prueba: [...] }
 */
async function generateExcel(absOutputPath, jsonContent) {
  const workbook = new ExcelJS.Workbook();
  let worksheet;

  // Intentar usar plantilla si existe en la raíz
  const templatePath = path.join(__dirname, '../../plantilla-tc.xlsx');
  if (fs.existsSync(templatePath)) {
    await workbook.xlsx.readFile(templatePath);
    worksheet = workbook.worksheets[0];
  } else {
    worksheet = workbook.addWorksheet('Test Cases');
    
    // Configurar columnas y encabezados
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Work Item Type', key: 'workItemType', width: 15 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Test Step', key: 'testStep', width: 10 },
      { header: 'Step Action', key: 'stepAction', width: 45 },
      { header: 'Step Expected', key: 'stepExpected', width: 45 },
      { header: 'Area Path', key: 'areaPath', width: 20 },
      { header: 'Assigned To', key: 'assignedTo', width: 20 },
      { header: 'State', key: 'state', width: 12 },
      { header: 'Automated Test Name', key: 'automatedTestName', width: 25 },
      { header: 'Automation status', key: 'automationStatus', width: 18 },
      { header: 'Tags', key: 'tags', width: 15 }
    ];

    // Estilo de encabezados
    const headerRow = worksheet.getRow(1);
    headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1F497D' } // Azul corporativo
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height = 25;
  }

  let data = jsonContent;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error('Error al parsear jsonContent como string en generateExcel:', e);
    }
  }

  let cases = [];
  if (Array.isArray(data)) {
    cases = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.casos_prueba)) {
      cases = data.casos_prueba;
    } else if (Array.isArray(data.casos)) {
      cases = data.casos;
    } else if (Array.isArray(data.casosPrueba)) {
      cases = data.casosPrueba;
    } else if (Array.isArray(data.test_cases)) {
      cases = data.test_cases;
    } else if (Array.isArray(data.testCases)) {
      cases = data.testCases;
    } else {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          cases = data[key];
          break;
        }
      }
    }
  }

  if (!cases || cases.length === 0) {
    throw new Error('No se encontraron casos de prueba válidos en el JSON proporcionado para escribir en el Excel.');
  }

  for (const tc of cases) {
    if (!tc || typeof tc !== 'object') continue;

    // Determinar etiqueta: API o WEB
    let tag = tc.tags || tc.tag || tc.tipo || tc.type || '';
    if (!tag) {
      const text = `${tc.titulo} ${tc.precondiciones ? tc.precondiciones.join(' ') : ''} ${tc.pasos ? tc.pasos.map(p => (p.accion || '') + ' ' + (p.resultado_esperado || '')).join(' ') : ''}`.toLowerCase();
      if (text.includes('api') || text.includes('backend') || text.includes('swagger') || text.includes('base de datos') || text.includes('bd ') || text.includes('db ') || text.includes('endpoint') || text.includes('get /') || text.includes('post /') || text.includes('put /') || text.includes('delete /') || text.includes('sap')) {
        tag = 'API';
      } else {
        tag = 'WEB';
      }
    } else {
      tag = String(tag).toUpperCase();
      if (tag.includes('API')) tag = 'API';
      else if (tag.includes('WEB') || tag.includes('FRONT')) tag = 'WEB';
    }

    // 1. Fila principal del caso de prueba
    const mainRow = worksheet.addRow({
      workItemType: 'Test Case',
      title: tc.titulo || tc.title || tc.name || '',
      areaPath: tc.area_path || tc.areaPath || process.env.AZURE_DEVOPS_PROJECT || 'AP31TPT-TERPELPOS-TRANSICION',
      assignedTo: tc.assigned_to || tc.assignedTo || '',
      state: tc.state || tc.status || 'Design',
      automationStatus: tc.automation_status || tc.automationStatus || 'Not Automated',
      tags: tag
    });

    // Estilo de fila principal para diferenciarla
    mainRow.font = { name: 'Segoe UI', size: 10, bold: true };
    mainRow.alignment = { vertical: 'top', wrapText: true };

    // 2. Filas para cada paso
    let steps = [];
    if (Array.isArray(tc.pasos)) {
      steps = tc.pasos;
    } else if (Array.isArray(tc.steps)) {
      steps = tc.steps;
    } else {
      for (const key of Object.keys(tc)) {
        if (Array.isArray(tc[key])) {
          steps = tc[key];
          break;
        }
      }
    }

    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const stepRow = worksheet.addRow({
        testStep: step.numero || step.step || step.num || step.index || '',
        stepAction: step.accion || step.action || step.description || '',
        stepExpected: step.resultado_esperado || step.expected_result || step.expected || step.result || ''
      });
      stepRow.font = { name: 'Segoe UI', size: 10 };
      stepRow.alignment = { vertical: 'top', wrapText: true };
    }
  }

  // Asegurar auto-ajuste de altura y wrapText en todas las celdas de datos
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      let maxLineCount = 1;
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
        const lineCount = String(cell.value || '').split('\n').length;
        if (lineCount > maxLineCount) maxLineCount = lineCount;
      });
      // Ajuste de altura básico según líneas
      row.height = Math.max(18, maxLineCount * 15);
    }
  });

  // Asegurar directorios creados
  fs.mkdirSync(path.dirname(absOutputPath), { recursive: true });
  await workbook.xlsx.writeFile(absOutputPath);
}

module.exports = { generateExcel };
