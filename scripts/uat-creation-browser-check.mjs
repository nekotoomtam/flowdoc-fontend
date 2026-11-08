import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {visualValue} from '../src/editor-visual-authoring.ts';

const base=process.env.FLOWDOC_PHASE1_URL??'http://127.0.0.1:5175';
const reference=process.env.FLOWDOC_UAT_DEFINITION;
const output=resolve(process.env.FLOWDOC_CREATION_EVIDENCE??'experiments/uat-creation-local');
assert.ok(reference,'Set FLOWDOC_UAT_DEFINITION to the verified UAT Model 20 definition');
const raw=JSON.parse(await readFile(reference,'utf8')),original=raw.template??raw.definition??raw;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:960}});
page.setDefaultTimeout(6000);
const calls=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{
  if(new URL(request.url()).pathname.startsWith('/api/'))calls.push({method:request.method(),path:new URL(request.url()).pathname});
});
const id=x=>page.locator('#'+x);
const act=(label)=>id('actions').getByRole('button',{name:label,exact:true});
const tree=(kind,name)=>id('tree').locator('[data-kind="'+kind+'"]').getByText(name,{exact:true});
const byKind=(kind)=>id('tree').locator('[data-kind="'+kind+'"]').first();
const photo=(name)=>page.screenshot({path:join(output,name+'.png')});
const source=original.sections[0];
const actualPage=original.pageLayouts[source.pageLayoutId??original.book.defaultPageLayoutId].page;
const mark=Date.now().toString(36);
async function form(values){
  for(const [key,value] of Object.entries(values)){
    const field=id('structure-form').locator('[name="'+key+'"]');
    if(await field.evaluate(e=>e.tagName)==='SELECT')await field.selectOption(String(value));
    else await field.fill(String(value));
  }
  await id('structure-form').getByRole('button',{name:'ยืนยัน',exact:true}).click();
}
async function component(label,part,value){
  try{await act(label).click();}catch(cause){console.error({label,selection:await id('selection').textContent(),actions:await id('actions').textContent(),errors});throw cause;}
  const dialog=id('visual-definition-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.locator('textarea, [name=definition]').count(),0);
  const visual=visualValue(part,value);
  // Interact only with actual form elements. Reference values never enter application state directly.
  const filled=await dialog.locator('.visual-form-body > [data-visual-kind]').evaluate((root,value)=>{
    const find=(parent,selector)=>parent.querySelector(':scope > '+selector);
    let edits=0;
    function set(input,value){
      const checked=input.type==='checkbox';
      if(input.disabled)return;
      if(checked){if(input.checked!==value)input.click();}
      else {
        input.focus();
        input.value=String(value);
        if(input.value!==String(value))throw Error('Unavailable control value '+value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      edits++;
    }
    function fill(control,value,path){
      if(!control)throw Error('Missing control '+path);
      switch(control.dataset.visualKind){
        case 'object': {
          const fields=Array.from(control.children);
          for(const wrapper of fields){
            const key=wrapper.dataset.visualField;
            const v=value[key];
            const input=wrapper.querySelector(':scope > label > [data-visual-present]');
            if(input)set(input,v!==undefined);
            if(v!==undefined)fill(find(wrapper,'[data-visual-kind]'),v,path+'.'+key);
          }
          break;
        }
        case 'choice': {
          const select=find(control,'[data-visual-choice]');
          const tag=typeof value==='object'?(value.type??'variable'):'literal';
          set(select,tag);
          fill(find(find(control,'[data-visual-choice-body]'),'[data-visual-kind]'),value,path+'.'+tag);
          break;
        }
        case 'list': {
          const rows=find(control,'[data-visual-rows]');
          const keyed=!Array.isArray(value);
          const existing=new Map(Array.from(rows.children,row=>[row.querySelector(':scope > div > label > [data-visual-key]')?.value,row]));
          for(const row of Array.from(rows.children)){
            if(keyed&&Object.hasOwn(value,row.querySelector(':scope > div > label > [data-visual-key]')?.value??''))continue;
            row.querySelector(':scope > div > .visual-row-actions > [data-visual-remove]').click();
          }
          for(const [key,entry] of Object.entries(value)){
            let row=keyed?existing.get(key):null;
            if(!row){find(control,'[data-visual-add]').click();row=rows.lastElementChild;}
            row.open=true;
            const body=find(row,'div');
            if(keyed)set(body.querySelector(':scope > label > [data-visual-key]'),key);
            fill(find(body,'[data-visual-kind]'),entry,path+'['+key+']');
            row.open=false;
          }
          break;
        }
        default:set(find(control,'[data-visual-value]'),value);
      }
    }
    fill(root,value,'definition');
    return edits;
  },visual);
  assert.ok(filled>0,part);
  if(part==='styles'){
    const row=dialog.locator('[data-visual-row]').first();
    await row.locator(':scope > summary').click();
    const field=row.locator('[data-visual-field=releaseId]');
    await field.locator('[data-visual-value]').fill('');
    await field.getByRole('button',{name:'เลือกจากรายการ'}).click();
    const release=Object.values(value)[0].font.releaseId;
    const picker=field.locator('[data-picker-options] select');
    assert.match(await picker.locator('option[value="'+release+'"]').textContent(),/Sarabun/);
    await picker.selectOption(release);
    await photo('03-styles-from-font-library');
  }
  if(part==='format'&&value.rowGroups?.length){
    await dialog.locator('[data-visual-field=rowGroups] [data-visual-row]').first().locator(':scope > summary').click();
    const field=dialog.locator('[data-visual-field=rowGroups] [data-visual-field=emptyRowTemplateId]');
    const expected=value.rowGroups[0].memberRepeat.emptyRowTemplateId;
    await field.locator('[data-visual-value]').fill('');
    await field.getByRole('button',{name:'เลือกจากรายการ'}).click();
    await field.locator('[data-picker-options] select').selectOption(expected);
    await photo('04-repeat-group-controls');
  }
  await dialog.getByRole('button',{name:'ใช้กับโครงเอกสาร',exact:true}).click();
  if(await dialog.isVisible()){await photo('failed-form');throw Error(part+': '+await dialog.locator('.visual-error').textContent());}
}
function comparable(definition){
  const d=structuredClone(definition);
  for(const k of ['templateId','docKey','name','version','examples'])delete d[k];
  assert.equal(Object.keys(d.pageLayouts).length,1);
  d.book.defaultPageLayoutId='page';
  d.pageLayouts={page:Object.values(d.pageLayouts)[0]};
  for(const s of d.sections){
    s.id='section';s.pageLayoutId='page';
    for(const f of Object.values(s.inputSchema.fields))if(f.type==='area')f.areaId='area';
    const fragment=s.source.fragment;
    const area=Object.values(fragment.nodes).find(n=>n.type==='area');
    const oldId=area.id;
    area.id='area-node';area.props.areaId='area';
    delete fragment.nodes[oldId];fragment.nodes[area.id]=area;
    fragment.rootIds=fragment.rootIds.map(id=>id===oldId?area.id:id);
  }
  d.areaFormats=Object.fromEntries(Object.values(d.areaFormats).map(f=>[f.key,{...f,ownerAreaId:'area'}]));
  return d;
}
try{
  await page.goto(base+'/library.html?phase1=1');
  await page.getByRole('button',{name:/สร้างโครงเอกสาร/}).click();
  const start=id('new-document-form');
  await start.waitFor();
  assert.equal(calls.filter(c=>c.method==='POST').length,0);
  await photo('01-blank-setup');
  const name='UAT สร้างด้วยปุ่ม '+mark;
  const values={name,key:'uat-visual-'+mark,section:source.label,size:actualPage.size,orientation:actualPage.orientation,
    ...Object.fromEntries(Object.entries(actualPage.margin).map(([side,length])=>[side,length.value]))};
  for(const [key,value] of Object.entries(values)){
    const field=start.locator('[name="'+key+'"]');
    if(await field.evaluate(e=>e.tagName)==='SELECT')await field.selectOption(String(value));else await field.fill(String(value));
  }
  await start.getByRole('button',{name:'เริ่มวางโครงบนกระดาษ'}).click();
  await id('paper').getByText('กระดาษเปล่า',{exact:true}).waitFor();
  assert.equal(await id('tree').locator('[data-kind=area]').count(),0);
  assert.equal(await id('tree').locator('[data-kind=format]').count(),0);
  assert.equal(await id('paper').locator('.definition-sheet').getAttribute('data-page-size'),'A4');
  await photo('02-empty-section');
  await id('advanced-details').locator('summary').click();
  if(await id('variable-panel').getAttribute('open')===null)await id('variable-panel').locator(':scope > summary').click();
  await act('ขนาดกระดาษและระยะขอบ').click();await form({left:36});
  await id('variables').locator('details').first().getByRole('button',{name:'+ ประกาศตัวแปร'}).click();
  await form({key:'headerBanner',type:'image',required:'yes'});
  await id('variables').getByRole('button',{name:'headerBanner · image'}).waitFor();
  await act('+ เพิ่มหัวกระดาษ').click();
  await act('ตำแหน่งและระยะ').click();
  await form({left:0,right:0,offset:0,height:79,gap:0});
  await act('+ เพิ่ม node').click();await form({type:'image'});await form({source:'global:headerBanner'});
  await id('paper').getByRole('button',{name:/headerBanner/}).waitFor();
  await byKind('section').click();await act('+ เพิ่มท้ายกระดาษ').click();
  await act('+ เพิ่มเลขหน้า').click();await form({field:'current'});
  await id('paper').getByRole('button',{name:'{{เลขหน้า}}',exact:true}).waitFor();
  await byKind('section').click();await act('+ เพิ่ม Area').click();
  await form({key:'parts',format:'cover'});
  await id('tree').locator('[data-kind=format]').first().waitFor();
  assert.equal(await id('tree').locator('[data-kind=format]').count(),1);
  await photo('03-first-area');

  await byKind('section').click();
  await component('ตัวแปรทั้งเอกสาร','globalSchema',original.globalSchema);
  await component('สไตล์เอกสาร','styles',original.styles);
  await component('กฎของ Section','section-settings',Object.fromEntries(Object.entries(source).filter(([key])=>['nameBase','numbering','headerMode','footerMode','role'].includes(key))));
  await component('ตัวแปรของ Section','section-schema',source.inputSchema);
  const areaButton=byKind('area');
  await byKind('header').click();await component('จัดเนื้อหาและรูปแบบหัว–ท้าย','band',source.header);
  await byKind('footer').click();await component('จัดเนื้อหาและรูปแบบหัว–ท้าย','band',source.footer);
  const formats=Object.values(original.areaFormats);
  for(const f of formats){
    if(f.key==='cover')await tree('format','cover').click();
    else {await areaButton.click();await act('+ เพิ่ม Format').click();await form({key:f.key});}
    assert.equal(await id('selection').textContent(),f.label??f.key);
    const {key,ownerAreaId,...part}=f;
    await component('จัดเนื้อหา ตัวแปร และการวนแถว','format',part);
    console.log('Authored '+key);
  }
  await byKind('section').click();
assert.equal(await id('tree').locator('[data-kind=format]').count(),14);
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/editor-phase1/drafts'));
  await page.getByRole('button',{name:'บันทึกโครง',exact:true}).click();
  const saved=await response,reply=await saved.json();
  assert.equal(saved.status(),201,JSON.stringify(reply));
  assert.equal(reply.value.revision,1);
  assert.deepEqual(comparable(reply.value.definition),comparable(original));
  await page.goto(base+'/library.html?phase1=1');
  const read=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/drafts/'+reply.value.templateId));
  await page.getByRole('button',{name:'เปิดแก้ไข '+name,exact:true}).click();
  assert.deepEqual(comparable((await (await read).json()).value.definition),comparable(original));
  await id('tree').getByRole('button',{name:'ขยายหรือยุบ parts',exact:true}).click();
  await id('tree').locator('[data-kind=format]').first().waitFor();
  assert.equal(await id('tree').locator('[data-kind=format]').count(),14);
  assert.match(await id('revision').textContent(),/Revision 1/);
  await tree('format','summary-dynamic').click();
  await id('paper').getByRole('button',{name:'{{menu}}',exact:true}).click();
  assert.match(await id('variable-detail').textContent(),/members\[\].*menu/);
  await photo('04-created-and-reopened');
  assert.deepEqual(errors,[]);
  assert.equal(calls.filter(c=>c.path.includes('preview')).length,0);
  const result={name,docKey:reply.value.docKey,templateId:reply.value.templateId,revision:reply.value.revision,
    sections:reply.value.definition.sections.length,formats:formats.length,
    formatNodes:formats.reduce((n,f)=>n+Object.keys(f.fragment.nodes).length,0),
    identityNormalization:['templateId','docKey','name','pageLayoutId','section id','areaId','area placement node id','Format map IDs'],
    equivalentModel20Definition:true,createdFromBlank:true,reopenedFromCatalog:true,
    complexPartsEnteredThroughVisualControls:true,advancedJson:false,generationRequests:0};
  await writeFile(join(output,'creation-verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser.close();}
