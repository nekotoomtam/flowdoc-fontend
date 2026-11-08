import assert from 'node:assert/strict';
import test from 'node:test';
import {applyTrialValueChanges,trialValueChanges} from '../scripts/trial-value-delta.mjs';

const row=index=>['sections',0,'data','rows',index,'menu'];
const keys=new Set([JSON.stringify(row(0)),JSON.stringify(row(1))]);
const source=()=>({data:{},sections:[{sectionKey:'S1',data:{rows:[{menu:'เหมือนกัน'},{menu:''}]}}],
  blanks:[row(1)],images:[]});

test('patch changes one text occurrence and keeps blank markers and immutable bases correct',()=>{
  const base=source(), next=structuredClone(base);
  next.sections[0].data.rows[1].menu='เหมือนกัน';
  next.blanks=[];
  const changes=trialValueChanges(base,next,keys);
  assert.deepEqual(changes,[{path:row(1),value:'เหมือนกัน'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(applyTrialValueChanges(base,{changes}))),next);
  const another=applyTrialValueChanges(base,{changes:[{path:row(0),value:''}]});
  assert.deepEqual(another.blanks,[row(1),row(0)]);
  assert.deepEqual(base,source());
});
test('patch refuses structural, non-text, attachment and ambiguous changes',()=>{
  const base=source();
  for(const change of [
    input=>input.sections[0].data.rows.pop(),
    input=>{input.sections[0].sectionKey='S2';},
    input=>input.images.push({id:'image',bytes:'changed'}),
  ]){
    const candidate=structuredClone(base);change(candidate);
    assert.equal(trialValueChanges(base,candidate,keys),undefined);
  }
  for(const invalid of [
    {path:['sections',0,'sectionKey'],value:'S2'},
    {path:['sections','0','data','rows',1,'menu'],value:'wrong'},
    {path:['data','__proto__','menu'],value:'wrong'},
    {path:row(3),value:'wrong'},
  ]){
    assert.throws(()=>applyTrialValueChanges(base,{changes:[{path:row(1),value:'first'},invalid]}),/invalid_trial_patch/);
    assert.deepEqual(base,source());
  }
  assert.throws(()=>applyTrialValueChanges(base,{changes:[{path:row(1),value:'first'},{path:row(1),value:'again'}]}),/invalid_trial_patch/);
});
