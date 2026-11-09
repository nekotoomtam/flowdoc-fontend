import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewQueue} from '../src/preview-worker-queue.mjs';

test('worker finishes a visible revision, coalesces waiting edits and publishes in order',async()=>{
  const first=Promise.withResolvers(),latest=Promise.withResolvers();
  const started=[],published=[];
  const queue=createPreviewQueue(async job=>{
    started.push(job.revision);
    if(job.revision===1)await first.promise;
    if(job.revision===3)await latest.promise;
    return job.value;
  },(job,value)=>published.push([job.revision,value]));
  const completed=queue.submit({revision:1,value:'first'});
  queue.submit({revision:2,value:'superseded'});
  queue.submit({revision:3,value:'latest'});
  assert.deepEqual(started,[1]);
  first.resolve();await new Promise(setImmediate);
  assert.deepEqual(started,[1,3]);
  assert.deepEqual(published,[[1,'first']]);
  latest.resolve();await completed;
  queue.submit({revision:2,value:'late'});
  assert.deepEqual(published,[[1,'first'],[3,'latest']]);
});
