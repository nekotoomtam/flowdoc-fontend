import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLines} from '../src/engine-layout.mjs';
test('split fragments retain one owner and contiguous UTF-16 source offsets',()=>{
 const text='เมนู ทดสอบทดสอบ';
 const lines=[{text:'เมนู',page:1},{text:'ทดสอบ',page:2},{text:'ทดสอบ',page:2}];
 const mapped=mapLines(text,lines);
 assert.deepEqual(mapped.map(l=>[l.from,l.to]),[[0,5],[5,10],[10,15]]);
 assert.equal(mapped.map(l=>text.slice(l.from,l.to)).join(''),text);
 assert.deepEqual(mapped.map(l=>l.page),[1,2,2]);
});
test('mismatched engine text must never be silently attached to another offset',()=>{
 assert.throws(()=>mapLines('ต้นฉบับ',[{text:'คนละข้อมูล',page:1}]),/Engine text/);
});
