import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({
  stdin:{contents:"export {applyStructureChange} from './src/editor-structure.ts'; export {applyPart} from './src/editor-creation.ts';",resolveDir:process.cwd()},
  bundle:true,format:'esm',platform:'node',write:false,
});
const {applyStructureChange,applyPart}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function fixture(){
  const node=id=>({id,type:'line',props:{}});
  const band=()=>({inputSchema:{type:'object',fields:{}},fragment:{
    rootIds:['first','next','columns'],nodes:{
      first:node('first'),next:node('next'),nested:node('nested'),
      columns:{id:'columns',type:'columns',props:{},columns:[{weight:1,childIds:['nested']}]},
    },
  }});
  return {nodeModelVersion:20,book:{defaultPageLayoutId:'main'},styles:{},globalSchema:{fields:{}},
    sections:[{id:'s',label:'Section',sectionKey:'s',inputSchema:{fields:{}},source:{kind:'blank'},header:band(),footer:band()}]};
}

test('changes one root page rule at a time and rejects nested pieces',()=>{
  const source=fixture();
  const apply=(definition,band,nodeId,mode)=>applyStructureChange(definition,{kind:'band-item-pages',at:{sectionId:'s',band,nodeId},mode}).definition;
  const footer=apply(source,'footer','first','first');
  assert.deepEqual(footer.sections[0].footer.firstPageOnly,['first']);
  assert.equal(source.sections[0].footer.firstPageOnly,undefined);
  const both=apply(footer,'header','next','first');
  assert.deepEqual(both.sections[0].header.firstPageOnly,['next']);
  const cleared=apply(both,'footer','first','all');
  assert.equal(Object.hasOwn(cleared.sections[0].footer,'firstPageOnly'),false);
  assert.deepEqual(cleared.sections[0].header.firstPageOnly,['next']);
  assert.throws(()=>apply(cleared,'footer','nested','first'),/โดยตรง/);
});

test('preserves saved page rules on band edits and removes them when the root is deleted',()=>{
  const source=fixture(),at={sectionId:'s',band:'footer'};
  source.sections[0].footer.firstPageOnly=['first','next'];
  const input=structuredClone(source.sections[0].footer);
  delete input.firstPageOnly;
  const edited=applyPart(source,at,'band',input);
  assert.deepEqual(edited.sections[0].footer.firstPageOnly,['first','next']);
  const deleted=applyStructureChange(edited,{kind:'delete',at:{...at,nodeId:'first'}}).definition;
  assert.deepEqual(deleted.sections[0].footer.firstPageOnly,['next']);
  assert.deepEqual(deleted.sections[0].footer.fragment.rootIds,['next','columns']);
});
