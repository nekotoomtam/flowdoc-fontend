import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMenuEdit } from '../src/binding.mjs';
test('an edit targets only the selected UAT occurrence and member',()=>{
 const source={sections:[{instanceKey:'I0001',data:{parts:[{format:'summary-dynamic',data:{groups:[{name:'A',members:[{menu:'ต้นฉบับ'},{menu:'อีกแถว'}]}]}},{format:'summary-dynamic',data:{groups:[{name:'B',members:[{menu:'ต้นฉบับ'}]}]}}]}}]};
 const edited=applyMenuEdit(source,{instanceKey:'I0001',entry:0,group:0,member:0},'ต้นแทรกฉบับ');
 assert.equal(source.sections[0].data.parts[0].data.groups[0].members[0].menu,'ต้นฉบับ');
 assert.equal(edited.sections[0].data.parts[0].data.groups[0].members[0].menu,'ต้นแทรกฉบับ');
 assert.equal(edited.sections[0].data.parts[0].data.groups[0].members[1].menu,'อีกแถว');
 assert.equal(edited.sections[0].data.parts[1].data.groups[0].members[0].menu,'ต้นฉบับ');
 assert.throws(()=>applyMenuEdit(source,{instanceKey:'missing',entry:0,group:0,member:0},'x'));
});
