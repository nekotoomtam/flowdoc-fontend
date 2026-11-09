const symbols={
  section:'M5 3h10l4 4v14H5z M15 3v5h4 M8 12h8 M8 16h8',
  area:'M3 5V3h2 M19 3h2v2 M21 19v2h-2 M5 21H3v-2 M3 9v6 M21 9v6 M9 3h6 M9 21h6 M7 8h10v8H7z',
  format:'M4 7h16v13H4z M7 4h10 M4 11h16 M8 15h8',
  node:'M4 5h16v14H4z M8 9h8 M8 13h5',
  table:'M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14',
  variable:'M4 12l8-8h7l2 2v7l-8 8z M16 8h1 M8 14h4 M10 12v4',
  header:'M5 3h14v18H5z M8 7h8 M8 10h8',
  footer:'M5 3h14v18H5z M8 14h8 M8 17h8',
  break:'M5 3h14v6H5z M5 15h14v6H5z M3 12h4 M10 12h4 M17 12h4',
  review:'M5 3h14v18H5z M8 12l3 3 5-6',
};
export type AuthoringIcon=keyof typeof symbols;

export function authoringIcon(kind:AuthoringIcon){
  const ns='http://www.w3.org/2000/svg';
  const icon=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
  icon.setAttribute('class','authoring-icon');
  icon.setAttribute('viewBox','0 0 24 24');
  icon.setAttribute('aria-hidden','true');
  icon.setAttribute('focusable','false');
  path.setAttribute('d',symbols[kind]);
  icon.append(path);
  return icon;
}

const steps:[AuthoringIcon,string,string][]=[
  ['section','ตั้งกระดาษ','ขนาด ขอบ และ Section แรก'],
  ['area','วางพื้นที่','Area คือจุดวางเนื้อหา'],
  ['format','สร้างรูปแบบ','Format กำหนดสิ่งที่อยู่ใน Area'],
  ['variable','ผูกตัวแปร','เชื่อมช่องบนกระดาษกับนิยาม'],
  ['review','ตรวจและบันทึก','ดูโครงต่อกันทั้งฉบับ'],
];

export function authoringRoadmap(target:HTMLElement,current:AuthoringIcon){
  target.replaceChildren(...steps.map(([icon,label,hint])=>{
    const step=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('small');
    if(icon===current)step.setAttribute('aria-current','step');
    name.textContent=label;detail.textContent=hint;
    step.append(authoringIcon(icon),name,detail);
    return step;
  }));
}
