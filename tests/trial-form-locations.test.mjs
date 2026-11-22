import test from 'node:test';
import assert from 'node:assert/strict';
import {trialBindings} from '../scripts/trial-preview-bindings.mjs';

test('mixed totals and images locate the correct bill without creating editable caret ranges',()=>{
  const ref=key=>({type:'field-ref',scope:'section',key});
  const nodes={
    total:{type:'text-block',children:[ref('quantity'),{type:'text',text:' '},ref('unit')]},
    logo:{type:'image',props:{source:{scope:'section',key:'logo'}}},
  };
  const definition={sections:[{id:'form',source:{fragment:{nodes}}}]};
  const resolved={sections:[{sectionId:'a',definitionId:'form'},{sectionId:'b',definitionId:'form'}],
    sourceMap:{totalB:{sourceId:'total',sectionId:'b'},logoA:{sourceId:'logo',sectionId:'a'}}};
  const box={xPt:15,yPt:25,widthPt:85,heightPt:10};
  const draw={pages:[{commands:[],images:[{nodeId:'logoA',...box}]},
    {commands:[{nodeId:'totalB',bounds:box,text:'4 containers'}]}]};
  const result=trialBindings(definition,resolved,{sections:[]},draw);
  const key=(i,name)=>JSON.stringify(['sections',i,'data',name]);
  assert.deepEqual({...result.fieldPages},{[key(0,'logo')]:0,[key(1,'quantity')]:1,[key(1,'unit')]:1});
  assert.deepEqual(result.formMarks[1],[{keys:[key(1,'quantity'),key(1,'unit')],...box}]);
  assert.equal(result.lines.size,0);
});
