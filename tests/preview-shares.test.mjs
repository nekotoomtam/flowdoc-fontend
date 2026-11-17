import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openPreviewShares, previewSharePacket, previewShareTtl} from '../scripts/preview-shares.mjs';

const templateId='5292ee75-a7c6-468b-9cbc-ed99f21b7053';
const session='23571f8b-d800-4fb3-8544-1056c7614c8a';
const otherSession='31d94658-68ee-4a9c-a645-72551c396983';
const draft={templateId,revision:3,fingerprint:'revision-3',docKey:'srs',name:'SRS',definition:{name:'SRS'}};

test('shared revision survives reopening the store, can be revoked and expires at 24 hours',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'flowdoc-shares-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=10;
  const store=await openPreviewShares(dir,()=>now);
  const first=await store.create(draft);
  assert.equal(first.expiresAt,new Date(now+previewShareTtl).toISOString());
  assert.notEqual(first.id,first.token);
  assert.ok(!(await readdir(dir)).some(name=>name.includes(first.token)));
  const revised={...draft,revision:4};
  const second=await store.create(revised);
  assert.equal((await store.list(templateId)).length,2);
  const reopened=await openPreviewShares(dir,()=>now);
  assert.equal((await reopened.get(first.token)).draft.revision,3);
  assert.equal(await reopened.revoke('other',first.id),false);
  assert.equal(await reopened.revoke(templateId,first.id),true);
  assert.equal(await reopened.get(first.token),undefined);
  now+=previewShareTtl;
  assert.equal(await reopened.get(second.token),undefined);
  assert.deepEqual(await reopened.list(templateId),[]);
});

test('guest requests only allow preview actions and bind run access to a tab and share',()=>{
  const share={id:'share',draft};
  const posted=previewSharePacket('POST','/preview',share,session,{trial:{data:{}},expectedRevision:99,sample:'benchmark',layoutMode:'resume'});
  assert.deepEqual(posted.body,{trial:{data:{}},expectedRevision:3});
  assert.equal(posted.shared.draft,draft);
  const paged=previewSharePacket('GET','/preview-runs/'+session+'/pages/0',share,session);
  const other=previewSharePacket('GET','/preview-runs/'+session+'/pages/0',share,otherSession);
  const anotherShare=previewSharePacket('GET','/preview-runs/'+session+'/pages/0',{...share,id:'other'},session);
  assert.notEqual(paged.shared.scope,other.shared.scope);
  assert.notEqual(paged.shared.scope,anotherShare.shared.scope);
  assert.equal(previewSharePacket('POST','/preview',share,session,{sample:'benchmark'}),undefined);
  assert.equal(previewSharePacket('PUT','/structure',share,session,{}),undefined);
  assert.equal(previewSharePacket('GET','/publication',share,session),undefined);
  assert.equal(previewSharePacket('GET','/preview-runs/'+session+'/pages/0',share,'bad'),undefined);
});
