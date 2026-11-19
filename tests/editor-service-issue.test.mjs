import assert from 'node:assert/strict';
import test from 'node:test';
import { assertIssuePreview, worksheetForm } from '../scripts/editor-service-issue.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const trial = { data: { title: '' }, sections: [], images: [] };
const draft = { templateId: id, revision: 2, fingerprint: 'saved' };
const proof = { ...draft, trial };
const request = { expectedRevision: 2, fingerprint: 'saved', previewId: id, trial };

test('issuance uses the full current preview and preserves intentional blanks', () => {
  assert.doesNotThrow(() => assertIssuePreview(draft, proof, request));
  assert.throws(() => assertIssuePreview(draft, proof, { ...request, expectedRevision: 1 }), /STALE_CURRENT/);
  assert.throws(() => assertIssuePreview(draft, { ...proof, scope: 'section' }, request), /PREVIEW_REQUIRED/);
  assert.throws(() => assertIssuePreview(draft, { ...proof, trial: { ...trial, blanks: ['/data/title'] } }, request), /PREVIEW_PLACEHOLDERS/);
  assert.throws(() => assertIssuePreview(draft, proof, { ...request, trial: { ...trial, data: { title: 'changed' } } }), /PREVIEW_INPUT_CHANGED/);
});

test('multipart issuance carries nested row uploads at their exact path', async () => {
  const field = 'seal/logo';
  const definition = {
    sections: [{ sectionKey: 'bill', inputSchema: { fields: { rows: { type: 'array', items: { fields: { [field]: { type: 'image' } } } } } } }],
  };
  const input = {
    data: {},
    sections: [{ sectionKey: 'bill', data: { rows: [{ [field]: id }] } }],
    images: [{ id, bytes: 'iVBORw0KGgo=' }],
  };
  const { form } = worksheetForm(definition, input);
  const payload = JSON.parse(await form.get('payload').text());
  assert.deepEqual(payload.sections[0].data.rows[0][field], { image: { upload: true } });
  assert.equal(form.get('/sections/0/data/rows/0/seal~1logo/image').type, 'image/png');
  assert.equal(input.sections[0].data.rows[0][field], id);
  assert.throws(() => worksheetForm(definition, { ...input, images: [] }), /INVALID_WORKSHEET_IMAGE/);
});
