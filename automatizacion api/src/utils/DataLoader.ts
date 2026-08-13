import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');

export class DataLoader {
  /** Carga y parsea un archivo JSON de la carpeta data/ */
  static load<T>(fileName: string): T {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Archivo de datos no encontrado: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  }
}
