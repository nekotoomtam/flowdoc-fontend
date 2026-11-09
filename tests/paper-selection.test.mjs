import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paperOffsetMap,paperCaretStops} from '../src/paper-selection.mjs';

test('pending Thai insertions keep their caret at the visible insertion point',()=>{
  const map=paperOffsetMap('ก่อนหลัง','ก่อนก้ก้หลัง');
  assert.deepEqual([4,5,8,10].map(map.toPaper),[4,4,4,6]);
  assert.equal(map.toInput(6),10);
});

test('the caret uses one position per shaped Thai cluster',()=>{
  assert.deepEqual(paperCaretStops({start:0,end:3,clusters:[[0,0,2],[8,0,2],[8,2,3]]},15),[[0,0],[8,2],[15,3]]);
  assert.deepEqual(paperCaretStops({start:0,end:0,blank:true,clusters:[]},10),[[0,0]]);
});
