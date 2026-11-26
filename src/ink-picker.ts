export function installInkPicker(prefix:'tag'|'style'){
  const button=document.getElementById(prefix+'-ink') as HTMLButtonElement;
  const palette=document.getElementById(prefix+'-palette')!;
  const input=document.getElementById(prefix+'-color') as HTMLInputElement;
  const label=button.getAttribute('aria-label')!;
  function refresh(){
    const mixed=input.hasAttribute('data-mixed');
    button.textContent=mixed?'Aa · ผสม':'Aa';
    button.setAttribute('aria-label',mixed?label+' ผสม':label);
    button.style.color=mixed?'':input.value;
    button.disabled=input.disabled;
    button.title=mixed?label+' ผสม':label+' '+input.value.toUpperCase();
    for(const swatch of palette.querySelectorAll('button')){
      swatch.setAttribute('aria-pressed',String(!mixed&&swatch.dataset.color===input.value));
    }
  }
  for(const [name,color] of Object.entries({ดำ:'#000000',แดง:'#ba2433',ส้ม:'#a74a10',เขียว:'#166549',น้ำเงิน:'#2459aa',ม่วง:'#753a87'})){
    const swatch=document.createElement('button');
    swatch.type='button';swatch.dataset.color=color;
    swatch.style.backgroundColor=color;swatch.title=name;swatch.setAttribute('aria-label',name);
    swatch.onmousedown=e=>e.preventDefault();
    swatch.onclick=()=>{
      palette.hidePopover();
      input.value=color;input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    palette.insertBefore(swatch,input);
  }
  button.onmousedown=e=>e.preventDefault();
  palette.addEventListener('beforetoggle',event=>{
    if((event as ToggleEvent).newState!=='open')return;
    const box=button.getBoundingClientRect();
    palette.style.left=Math.max(4,Math.min(box.left,window.innerWidth-254))+'px';
    palette.style.top=(box.bottom+46>window.innerHeight?Math.max(4,box.top-44):box.bottom+3)+'px';
  });
  input.addEventListener('ink-sync',refresh);
  input.addEventListener('input',refresh);
  input.addEventListener('change',()=>{palette.hidePopover();refresh();});
  refresh();
}
