/** Ask immediately before sending the request that can create an immutable version. */
export function confirmPublication(name:string,version:number,pinned?:number|null){
  const dialog=document.createElement('dialog');
  dialog.className='publication-confirm';
  const form=document.createElement('form');form.method='dialog';
  const heading=document.createElement('h2');heading.id='confirm-publication-title';
  heading.textContent='เผยแพร่เป็นรุ่น '+version+'?';
  dialog.setAttribute('aria-labelledby',heading.id);
  const description=document.createElement('p');
  description.textContent=name+' · หลังเผยแพร่แล้ว รุ่นนี้จะแก้ไขไม่ได้'+(pinned?' · ระบบรับงานยังใช้รุ่น '+pinned:'');
  dialog.setAttribute('aria-describedby','confirm-publication-description');description.id='confirm-publication-description';
  const actions=document.createElement('div');actions.className='paper-commands';
  const cancel=document.createElement('button');cancel.value='cancel';cancel.textContent='ยกเลิก';cancel.autofocus=true;
  const publish=document.createElement('button');publish.value='publish';publish.className='primary';publish.textContent='ยืนยันเผยแพร่รุ่น '+version;
  actions.append(cancel,publish);form.append(heading,description,actions);dialog.append(form);
  document.body.append(dialog);
  return new Promise<boolean>(resolve=>{
    dialog.addEventListener('close',()=>{dialog.remove();resolve(dialog.returnValue==='publish');},{once:true});
    dialog.showModal();
  });
}
