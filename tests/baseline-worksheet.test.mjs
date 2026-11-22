import assert from 'node:assert/strict';
import test from 'node:test';
import {baselineWorksheet} from '../scripts/baseline-worksheet.mjs';

test('maps a missing string to its row in the selected version and keeps the source sample intact',()=>{
  const section=fields=>({sections:[{sectionKey:'job',inputSchema:{fields:{
    items:{type:'array',items:{fields}}
  }}}]});
  const old=section({description:{type:'string'}});
  const next=section({description:{type:'string'},repairDetail:{type:'string'}});
  const sample={data:{},sections:[{sectionKey:'job',data:{items:[
    {description:'inspect'},{description:'replace'}
  ]}}]};
  const path=i=>['sections',0,'data','items',i,'repairDetail'];
  const edits={[JSON.stringify(path(1))]:'repaired'};
  const {trial,editable}=baselineWorksheet(next,sample,edits);
  assert.deepEqual(trial.blanks,[path(0)]);
  assert.deepEqual(editable,[0,1].map(i=>JSON.stringify(path(i))));
  assert.equal(trial.sections[0].data.items[1].repairDetail,'repaired');
  assert.deepEqual(baselineWorksheet(old,sample,edits).trial.sections,sample.sections);
  assert.equal(Object.hasOwn(sample.sections[0].data.items[1],'repairDetail'),false);
});
test('projects the previous receipt without mutating it and exports the exact target payload',()=>{
  const target={sections:[{sectionKey:'S0001',inputSchema:{fields:{inspectionDetail:{type:'string'}}}}]};
  const sample={data:{},sections:[{sectionKey:'S0001',instanceKey:'A',data:{jobNumber:'JOB',customerName:'A',items:[{repairDetail:'old'}]}}]};
  const path=['sections',0,'data','inspectionDetail'];
  const blank=baselineWorksheet(target,sample,{});
  assert.deepEqual(blank.omitted.map(p=>p.at(-1)),['jobNumber','customerName','items']);
  assert.deepEqual(blank.trial.blanks,[path]);
  assert.deepEqual(blank.payload.sections[0].data,{});
  const filled=baselineWorksheet(target,sample,{[JSON.stringify(path)]:'checked'});
  assert.deepEqual(filled.payload.sections[0].data,{inspectionDetail:'checked'});
  assert.deepEqual(filled.trial.blanks,[]);
  assert.equal(sample.sections[0].data.items[0].repairDetail,'old');
});
