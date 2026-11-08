import {execFile} from 'node:child_process';

// This adapter belongs to the local Oracle lab, not the browser bundle.
const command = `sudo docker exec -i flowdoc-library-model20-stage-20261108-db psql -X -qAt -U stage -d flowdoc -v ON_ERROR_STOP=1`;
const sql = `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '3s';
SELECT COALESCE(json_agg(row_to_json(item) ORDER BY item."updatedAt" DESC, item."templateId"), '[]'::json)
FROM (
 SELECT t.id AS "templateId", t.doc_key AS "docKey", t.name,
        c.revision, COALESCE(c.updated_at, t.created_at) AS "updatedAt",
        NULLIF(c.payload->>'description', '') AS description
 FROM authoring_templates a
 JOIN templates t ON t.id = a.template_id
 LEFT JOIN template_current c ON c.template_id = t.id
 WHERE a.principal = 'local-owner'
) item;
ROLLBACK;
`;

function readLabCatalog() {
  return new Promise((resolve, reject) => {
    const ssh = execFile('ssh.exe', [
      '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=5', '-i', 'C:/test/keyflow.key', 'ubuntu@129.221.205.23', command,
    ], {windowsHide: true, timeout: 9000, maxBuffer: 1024 * 1024}, (error, stdout) => {
      if (error) return reject(error);
      try {
        const rows = JSON.parse(stdout);
        if (!Array.isArray(rows)) throw Error('Invalid catalog');
        resolve(rows);
      } catch (parseError) {
        reject(parseError);
      }
    });
    ssh.stdin.on('error', () => {}); // The execFile callback handles early process exit.
    ssh.stdin.end(sql);
  });
}

export function libraryBridge({enabled = process.env.FLOWDOC_LIBRARY_ORACLE === '1', readCatalog = readLabCatalog} = {}) {
  let inFlight;
  return {
    name: 'flowdoc-local-library',
    configureServer(server) {
      server.middlewares.use('/api/library', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const send = (status, value) => {
          res.statusCode = status;
          res.end(JSON.stringify(value));
        };
        if (req.url !== '/' && req.url !== '') return send(404, {error: 'not_found'});
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          return send(405, {error: 'method_not_allowed'});
        }
        const host = req.headers.host ?? '';
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
            (req.headers.origin && req.headers.origin !== 'http://' + host) ||
            (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none')) {
          return send(403, {error: 'forbidden'});
        }
        if (!enabled) return send(503, {error: 'source_disabled'});
        try {
          inFlight ??= Promise.resolve().then(readCatalog).finally(() => { inFlight = undefined; });
          return send(200, {items: await inFlight});
        } catch {
          return send(503, {error: 'source_unavailable'});
        }
      });
    },
  };
}
