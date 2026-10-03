import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore, MAX_STATE_BYTES } from '../electron/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'src');
const portArgument = process.argv.indexOf('--port');
const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a preview port from 1024 through 65535.');
const store = new WorkspaceStore(process.env.COORDINATOR_PREVIEW_DATA || path.join(root, '.preview-data'));
const packageMetadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    const error = new Error('Use application/json for workspace changes.'); error.status = 415; throw error;
  }
  if (Number(request.headers['content-length'] || 0) > MAX_STATE_BYTES) {
    const error = new Error('El espacio de trabajo es demasiado grande (máximo 24 MB).'); error.status = 413; throw error;
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_STATE_BYTES) { const error = new Error('El espacio de trabajo es demasiado grande (máximo 24 MB).'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('La solicitud no contiene datos JSON válidos.'); error.status = 400; throw error; }
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!allowedHosts.has(request.headers.host)) return json(response, 403, { error: 'Local preview host required.' });
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return json(response, 403, { error: 'Cross-origin requests are not allowed.' });
  if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) {
    return json(response, 403, { error: 'Open this app directly on its loopback address.' });
  }
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, await store.load());
      if (request.method === 'GET' && url.pathname === '/api/info') {
        return json(response, 200, { dataPath: store.file, version: packageMetadata.version, recoveryNotice: store.recoveryNotice });
      }
      if (request.method === 'POST') {
        // Browsers send Origin with JSON POST. Requiring it prevents local drive-by writes.
        if (origin !== `http://${request.headers.host}`) return json(response, 403, { error: 'A same-origin request is required to change local data.' });
        const body = await readBody(request);
        if (url.pathname === '/api/state') return json(response, 200, await store.save(body));
        if (url.pathname === '/api/import-canvas') return json(response, 409, { error: 'La importación de carpetas está disponible en la aplicación de escritorio. Ábrela con npm start o importa aquí un archivo JSON de Canvas.' });
      }
      return json(response, 404, { error: 'This local API route does not exist.' });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
    let relative;
    try { relative = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html'; }
    catch { return json(response, 400, { error: 'Invalid file path.' }); }
    // Every segment must be a regular public asset name; no dotfiles, separators,
    // drive letters, encoded traversal, or repository files can pass this allowlist.
    if (relative.split('/').some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) || !mime[path.extname(relative)]) {
      return json(response, 404, { error: 'File not found.' });
    }
    const filename = path.resolve(renderer, relative);
    const real = await fs.realpath(filename);
    const inside = path.relative(renderer, real);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return json(response, 404, { error: 'File not found.' });
    const file = await fs.readFile(real);
    response.writeHead(200, { 'Content-Type': `${mime[path.extname(relative)]}${/\.(html|css|js|json|svg)$/.test(relative) ? '; charset=utf-8' : ''}` });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    if (!response.headersSent) json(response, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? 'File not found.' : error.message });
    else response.end();
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () => console.log(`Canvas Coordinator preview: http://127.0.0.1:${port}\nLocal preview data: ${store.file}`));
