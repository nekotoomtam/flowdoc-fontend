import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir, rename} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const apiPrefix = '/api/editor-phase1';
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const toolNames = ['get_flowdocmake_context', 'get_authoring_contract', 'validate_template',
  'create_template_draft', 'get_template_draft', 'update_template_draft', 'create_preview_upload',
  'upload_preview_image_file', 'finalize_preview_upload', 'preview_template_draft', 'get_preview_status', 'save_preview_pdf'];

class TrialError extends Error {
  constructor(code, status = 422, issues = []) {
    super(code);
    this.status = status;
    this.issues = issues.length ? issues : [{code}];
  }
}

async function connectFlowDocMake(configPath) {
  const config = await json(configPath);
  const upstream = new URL(config.url);
  if (upstream.origin !== 'http://127.0.0.1:3030' || config.container !== 'flowdoc-maersk-pair-056-api')
    throw Error('Use the separate Maersk Service/Core 0.5.6 trial');
  const sdk = join(config.serviceRoot, 'node_modules', '@modelcontextprotocol', 'client', 'dist');
  const {Client} = await import(pathToFileURL(join(sdk, 'index.mjs')));
  const {StdioClientTransport} = await import(pathToFileURL(join(sdk, 'stdio.mjs')));
  const client = new Client({name: 'flowdoc-web-maersk-trial', version: '1.0.0'});
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(config.pluginRoot, 'scripts', 'server.mjs')],
    env: {...process.env, FLOWDOCMAKE_CONFIG: configPath},
    stderr: 'pipe',
  });
  async function call(name, args = {}) {
    const raw = await client.callTool({name, arguments: args}, undefined, {timeout: 35_000});
    const reply = JSON.parse(raw.content.find(item => item.type === 'text').text);
    if (raw.isError || reply.ok === false) {
      const issues = reply.issues?.map(({code, path}) => ({code, path}));
      const code = issues?.[0]?.code ?? reply.code ?? 'FLOWDOCMAKE_REJECTED';
      throw new TrialError(code, ['STALE_CURRENT', 'IDEMPOTENCY_CONFLICT'].includes(code) ? 409 : 422, issues);
    }
    return reply.value ?? reply;
  }

  try {
    await client.connect(transport);
    const listed = new Set((await client.listTools()).tools.map(tool => tool.name));
    if (!toolNames.every(name => listed.has(name))) throw Error('Required FlowDocMake tools are missing');
    const readiness = await call('get_flowdocmake_context');
    const contract = await call('get_authoring_contract');
    if (!readiness.ready || readiness.runtime?.service !== '0.5.6' || readiness.runtime?.core !== '0.5.6' ||
      contract.nodeModelVersions?.join(',') !== '20' || contract.publicationEnabled !== false)
      throw Error('The isolated Model 20 candidate did not pass preflight');
    return {call, close: () => client.close()};
  } catch (error) {
    await client.close();
    throw error;
  }
}

function send(res, status, value, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': contentType, 'Cache-Control': 'no-store'});
  res.end(contentType.startsWith('application/json') ? JSON.stringify(value) : value);
}

async function readBody(req, maxBytes) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new TrialError('JSON_REQUIRED', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new TrialError('REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw new TrialError('INVALID_JSON', 400);}
}

function sameRevision() {
  return new TrialError('STALE_CURRENT', 409);
}

export async function maerskImportTrial({configPath, bundlePath, stateDirectory, origin, catalog = []}) {
  const bundle = await json(bundlePath);
  if (!/^[0-9a-f]{64}$/.test(bundle.sha256) || bundle.definition.nodeModelVersion !== 20 || !bundle.pages.length)
    throw Error('Invalid Maersk source bundle');
  const assets = await Promise.all(bundle.assets.map(async asset => {
    const path = join(dirname(bundlePath), asset.file);
    return {...asset, path, byteSize: (await readFile(path)).length};
  }));
  await mkdir(stateDirectory, {recursive: true});
  const byKey = new Map();
  const byId = new Map();
  for (const file of await readdir(stateDirectory)) {
    if (!file.endsWith('.json') || !uuid.test(file.slice(0, -5))) continue;
    const record = await json(join(stateDirectory, file));
    if (uuid.test(record.id) && record.key === file.slice(0, -5)) {
      byKey.set(record.key, record);
      if (record.ready) byId.set(record.id, record);
    }
  }
  const {call, close} = await connectFlowDocMake(configPath);
  const importing = new Map();
  const previewing = new Set();

  async function remember(record) {
    const path = join(stateDirectory, record.key + '.json');
    await writeFile(path + '.tmp', JSON.stringify(record), {mode: 0o600});
    await rename(path + '.tmp', path);
    byKey.set(record.key, record);
    if (record.ready) byId.set(record.id, record);
  }

  function sample(record, docKey) {
    return {docKey, version: 1, data: {}, sections: record.pages.map(i => structuredClone(bundle.pages[i - 1]))};
  }

  async function create({key, pages}) {
    const docKey = 'maersk-import-' + key;
    const pageLabel = pages.length <= 4 ? pages.join(', ') : pages.length + ' หน้า';
    const name = 'Maersk · Delivery Order · Import ' + pageLabel;
    const requested = byKey.get(key);
    if (requested && JSON.stringify(requested.pages) !== JSON.stringify(pages))
      throw new TrialError('IDEMPOTENCY_CONFLICT', 409);
    if (requested?.ready) return decorate(await call('get_template_draft', {templateId: requested.id}), requested);

    const definition = {...structuredClone(bundle.definition), docKey, name};
    await call('validate_template', {definition, sampleRequest: sample({pages}, docKey)});
    const created = requested ?? await call('create_template_draft', {docKey, name, idempotencyKey: key + '-identity'});
    const record = requested ?? {key, id: created.templateId, pages, docKey, name, updatedAt: new Date().toISOString()};
    if (!requested) await remember(record);
    const draft = await call('get_template_draft', {templateId: record.id});
    const saved = draft.revision ? draft : await call('update_template_draft', {
      templateId: record.id, expectedRevision: 0, idempotencyKey: key + '-structure',
      definition: {...definition, templateId: record.id},
    });
    const ready = {...record, ready: true, revision: saved.revision};
    await remember(ready);
    return decorate(saved, ready);
  }

  function decorate(draft, record) {
    return {...draft, importSourcePages: record.pages};
  }

  async function startImport(body) {
    const {sha256, requestId, pages} = body ?? {};
    if (sha256 !== bundle.sha256) throw new TrialError('MAERSK_PDF_NOT_MATCHED');
    if (!uuid.test(requestId ?? '') || !Array.isArray(pages) || !pages.length ||
      pages.some((page, i) => !Number.isInteger(page) || page < 1 || page > bundle.pages.length || (i && page <= pages[i - 1])))
      throw new TrialError('IMPORT_PAGES_INVALID', 400);
    const existing = importing.get(requestId);
    if (existing) {
      if (existing.pages.join(',') !== pages.join(',')) throw new TrialError('IDEMPOTENCY_CONFLICT', 409);
      return existing.promise;
    }
    const promise = create({key: requestId, pages});
    importing.set(requestId, {pages, promise});
    try {return await promise;}
    finally {importing.delete(requestId);}
  }

  async function saveDraft(record, body, renameSection) {
    const draft = await call('get_template_draft', {templateId: record.id});
    if (draft.revision !== body?.expectedRevision) throw sameRevision();
    let definition = body.definition;
    if (renameSection) {
      definition = structuredClone(draft.definition);
      const section = definition.sections.find(item => item.id === body.sectionId);
      if (!section || typeof body.label !== 'string' || !body.label.trim()) throw new TrialError('SECTION_LABEL_INVALID');
      section.label = body.label.trim();
    }
    if (definition?.templateId !== record.id || definition?.docKey !== record.docKey ||
      definition?.nodeModelVersion !== 20 || !uuid.test(body.idempotencyKey ?? '')) throw new TrialError('DRAFT_INPUT_INVALID');
    const saved = await call('update_template_draft', {
      templateId: record.id, expectedRevision: draft.revision, idempotencyKey: body.idempotencyKey, definition,
    });
    await remember({...record, revision: saved.revision, updatedAt: new Date().toISOString()});
    return decorate(saved, record);
  }

  async function previewDraft(record, expectedRevision) {
    if (previewing.has(record.id)) throw new TrialError('PREVIEW_RUNNING', 409);
    previewing.add(record.id);
    try {
      const draft = await call('get_template_draft', {templateId: record.id});
      if (draft.revision !== expectedRevision) throw sameRevision();
      const key = randomUUID();
      const upload = await call('create_preview_upload', {
        requestKey: key, items: assets.map(({key, byteSize}) => ({key, byteSize, mediaType: 'image/png', source: 'upload'})),
      });
      for (const item of upload.items) {
        const asset = assets.find(asset => asset.key === item.key);
        if (!asset) throw Error('Unknown asset');
        await call('upload_preview_image_file', {uploadId: upload.uploadId, resourceId: item.resourceId, path: asset.path});
      }
      await call('finalize_preview_upload', {uploadId: upload.uploadId});
      const ids = Object.fromEntries(upload.items.map(({key, resourceId}) => [key, resourceId]));
      const request = sample(record, draft.docKey);
      request.uploadId = upload.uploadId;
      for (const section of request.sections) {
        Object.assign(section.header, {logo: ids.logo, title: ids.title});
        section.footer.signature = ids.signature;
      }
      const job = await call('preview_template_draft', {
        templateId: record.id, expectedRevision: draft.revision, sampleRequest: request, idempotencyKey: key + '-preview',
      });
      for (let i = 0; i < 75; i++) {
        const progress = await call('get_preview_status', {jobId: job.jobId});
        if (progress.status === 'succeeded') {
          const result = await call('save_preview_pdf', {jobId: job.jobId});
          const pdf = await readFile(result.path);
          if (result.revision !== draft.revision || result.fingerprint !== draft.fingerprint ||
            createHash('sha256').update(pdf).digest('hex') !== result.sha256) throw Error('Preview receipt mismatch');
          return pdf;
        }
        if (!['queued', 'running'].includes(progress.status)) throw new TrialError('PREVIEW_FAILED');
        await wait(900);
      }
      throw new TrialError('PREVIEW_TIMED_OUT', 504);
    } finally {
      previewing.delete(record.id);
    }
  }

  return {
    name: 'flowdoc-maersk-import-trial',
    transformIndexHtml() {
      return [{tag: 'meta', attrs: {name: 'flowdoc-maersk-import-trial', content: 'enabled'}, injectTo: 'head'}];
    },
    configureServer(server) {
      server.httpServer?.once('close', () => {void close();});
      server.middlewares.use(apiPrefix, async (req, res, next) => {
        const path = new URL(req.url, origin).pathname;
        const route = /^\/drafts\/([0-9a-f-]+)(\/(?:structure|maersk-preview))?$/i.exec(path);
        const record = route && byId.get(route[1]);
        const catalogRequest = path === '/catalog' && req.method === 'GET';
        const importRequest = path === '/import/maersk' && req.method === 'POST';
        if (!catalogRequest && !importRequest && !record) return next();
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin)
          return send(res, 403, {ok: false, issues: [{code: 'TRIAL_ORIGIN_REQUIRED'}]});
        try {
          if (catalogRequest) {
            return send(res, 200, {items: [...Array.from(byId.values(), record => ({
              templateId: record.id, docKey: record.docKey, name: record.name, revision: record.revision,
              updatedAt: record.updatedAt, description: 'Maersk · Model 20',
            })), ...catalog]});
          }
          if (importRequest) return send(res, 201, {ok: true, value: await startImport(await readBody(req, 8192))});
          if (req.method === 'GET' && !route[2])
            return send(res, 200, {ok: true, value: decorate(await call('get_template_draft', {templateId: record.id}), record)});
          if (req.method === 'PUT' && (!route[2] || route[2] === '/structure'))
            return send(res, 200, {ok: true, value: await saveDraft(record, await readBody(req, 2_097_152), !route[2])});
          if (req.method === 'POST' && route[2] === '/maersk-preview') {
            const body = await readBody(req, 8192);
            return send(res, 200, await previewDraft(record, body?.expectedRevision), 'application/pdf');
          }
          return next();
        } catch (error) {
          const trial = error instanceof TrialError;
          return send(res, trial ? error.status : 502, {ok: false, issues: trial ? error.issues : [{code: 'TRIAL_SERVICE_ERROR'}]});
        }
      });
    },
  };
}
