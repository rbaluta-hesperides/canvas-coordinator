import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { normalizeCourses } from '../src/domain.js';

export const MAX_STATE_BYTES = 24 * 1024 * 1024;
const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1) {
    throw new Error('El formato de este espacio de trabajo no es compatible. Se requiere la versión 1.');
  }
  for (const key of ['courses', 'templates', 'drafts']) {
    if (!Array.isArray(state[key]) || state[key].length > 10000) throw new Error(`Datos no válidos en el espacio de trabajo: ${key}.`);
  }
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
    throw new Error('Los ajustes de coordinación no son válidos.');
  }
  for (const key of ['name', 'email', 'signature']) {
    if (typeof state.settings[key] !== 'string' || state.settings[key].length > 100000) {
      throw new Error(`El campo de coordinación no es válido: ${key}.`);
    }
  }
  if (state.composer !== null && (typeof state.composer !== 'object' || Array.isArray(state.composer))) {
    throw new Error('Los datos del editor de correo no son válidos.');
  }
  return state;
}

async function readJson(file, maxBytes = MAX_STATE_BYTES) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`El archivo es demasiado grande o no es un archivo válido: ${path.basename(file)}`);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function atomicWrite(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

/** Serialized, atomic persistence. A damaged primary is never silently replaced. */
export class WorkspaceStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'workspace.json');
    this.backup = `${this.file}.bak`;
    this.recoveryNotice = null;
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async readCurrent() {
    try {
      return validateState(await readJson(this.file));
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Recover a missing primary as well, for example after external file changes.
        try {
          const recovered = validateState(await readJson(this.backup));
          await atomicWrite(this.file, JSON.stringify(recovered, null, 2));
          this.recoveryNotice = 'Faltaba el archivo del espacio de trabajo. Se ha recuperado la última copia de seguridad guardada.';
          return recovered;
        } catch (backupError) {
          if (backupError.code === 'ENOENT') return null;
          throw new Error(`No se pudo leer la copia de seguridad. Los archivos se conservan en ${this.directory}. Restaura una copia válida del espacio de trabajo antes de continuar.`, { cause: backupError });
        }
      }
      let recovered;
      try {
        recovered = validateState(await readJson(this.backup));
      } catch {
        throw new Error(`No se pudo leer el espacio de trabajo y no hay una copia de seguridad válida. Los archivos se conservan en ${this.directory}. Restaura una copia válida antes de continuar.`, { cause: error });
      }
      const preserved = `${this.file}.corrupt-${Date.now()}-${randomUUID()}`;
      await fs.copyFile(this.file, preserved);
      await atomicWrite(this.file, JSON.stringify(recovered, null, 2));
      this.recoveryNotice = `Se ha recuperado la última copia de seguridad válida. El archivo que no se pudo leer se conserva en ${preserved}.`;
      return recovered;
    }
  }

  load() {
    return this.enqueue(() => this.readCurrent());
  }

  save(state) {
    // Serialize now so a caller cannot mutate data while another save is pending.
    let text;
    try {
      validateState(state);
      text = JSON.stringify(state, null, 2);
      if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) throw new Error('El espacio de trabajo es demasiado grande para guardarlo (máximo 24 MB).');
      validateState(JSON.parse(text));
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const previous = await this.readCurrent();
      if (previous) await atomicWrite(this.backup, JSON.stringify(previous, null, 2));
      await atomicWrite(this.file, text);
      return { savedAt: new Date().toISOString(), path: this.file };
    });
  }
}

export function defaultCanvasCacheDirectories() {
  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config'));
  return ['Canvas Manager', 'canvas-manager'].map(name => path.join(appData, name, 'cache', 'canvas'));
}

async function existingCourses(directory) {
  try { return (await fs.stat(path.join(directory, 'courses.json'))).isFile(); }
  catch { return false; }
}

export async function defaultCanvasCacheDirectory() {
  for (const directory of defaultCanvasCacheDirectories()) if (await existingCourses(directory)) return directory;
  return defaultCanvasCacheDirectories()[0];
}

async function resolveCacheDirectory(folder) {
  const selected = path.resolve(folder);
  for (const candidate of [selected, path.join(selected, 'cache', 'canvas'), path.join(selected, 'data', 'cache', 'canvas')]) {
    if (await existingCourses(candidate)) return { directory: candidate, relocated: false };
  }
  // A repository does not contain account cache data. Recognize that exact project,
  // then use its standard per-machine cache; never inspect its credentials/config.
  try {
    const metadata = await readJson(path.join(selected, 'package.json'), 256 * 1024);
    if (metadata.name === 'canvas-manager') {
      for (const candidate of defaultCanvasCacheDirectories()) {
        if (await existingCourses(candidate)) return { directory: candidate, relocated: true };
      }
    }
  } catch { /* Not a Canvas Manager repository. */ }
  throw new Error(`No se encontró el archivo courses.json de Canvas Manager. Elige su carpeta cache/canvas (normalmente ${defaultCanvasCacheDirectories()[0]}). Si está vacía, abre Canvas Manager y carga primero los cursos y sus módulos.`);
}

export async function importCanvasDirectory(folder) {
  if (typeof folder !== 'string' || !folder.trim()) throw new Error('Elige la carpeta de datos locales de Canvas Manager.');
  const { directory, relocated } = await resolveCacheDirectory(folder);
  const entry = await readJson(path.join(directory, 'courses.json'), MAX_IMPORT_BYTES);
  const owner = entry?.userId == null ? '' : String(entry.userId).trim();
  if (!owner || !Array.isArray(entry?.data)) {
    throw new Error('Los datos locales de Canvas no identifican la cuenta o no incluyen la lista de cursos. Actualiza los cursos en Canvas Manager y vuelve a importarlos.');
  }
  if (entry.data.length > 1000) throw new Error('Los datos de Canvas contienen demasiados cursos (máximo 1.000).');
  const warnings = relocated ? [`Canvas Manager guarda sus datos locales fuera del proyecto. Se han importado desde ${directory}.`] : [];
  const rawCourses = [];
  let importedBytes = 0;
  for (const course of entry.data) {
    const id = String(course?.id ?? '');
    if (!/^\d+$/.test(id)) {
      warnings.push('Se ha omitido un curso con un identificador de Canvas no válido.');
      continue;
    }
    let content = null;
    let contentSavedAt = null;
    try {
      const file = path.join(directory, `content-${id}.json`);
      importedBytes += (await fs.stat(file)).size;
      if (importedBytes > 128 * 1024 * 1024) throw new Error('Los datos seleccionados de Canvas son demasiado grandes (máximo 128 MB de contenido).');
      const cached = await readJson(file, MAX_IMPORT_BYTES);
      if (cached?.userId == null || String(cached.userId).trim() !== owner) {
        warnings.push(`${course.name || id}: se ha omitido contenido de otra cuenta de Canvas o de una cuenta sin identificar.`);
      } else if (!cached.data || !Array.isArray(cached.data.modules)) {
        warnings.push(`${course.name || id}: no hay datos de los módulos. Actualiza este curso en Canvas Manager.`);
      } else {
        content = cached.data;
        contentSavedAt = cached.savedAt ?? null;
      }
    } catch (error) {
      if (importedBytes > 128 * 1024 * 1024) throw error;
      warnings.push(`${course.name || id}: ${error.code === 'ENOENT' ? 'todavía no hay módulos guardados; carga primero este curso en Canvas Manager.' : 'no se pudieron leer los módulos guardados; actualiza este curso en Canvas Manager.'}`);
    }
    rawCourses.push({ ...course, hasStructure: !!content, modules: content?.modules || [], pages: content?.pages || [],
      source: { type: 'canvas-manager', userId: owner, savedAt: contentSavedAt ?? entry.savedAt ?? null },
      savedAt: contentSavedAt ?? entry.savedAt ?? null });
  }
  const courses = normalizeCourses({ courses: rawCourses });
  return { courses, source: directory, importedAt: new Date().toISOString(), savedAt: entry.savedAt ?? null, warnings };
}
