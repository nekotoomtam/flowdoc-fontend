type Glyph = readonly [tone:string, path:string];

const glyphs:Record<string,Glyph>={
  section:['page','M4 2h7l3 3v11H4z M10 2v4h4 M7 9h4 M7 12h4'],
  header:['page','M3 3h12v12H3z M3 7h12 M6 5h6'],
  footer:['page','M3 3h12v12H3z M3 11h12 M6 13h6'],
  'page-break':['page','M4 7V2h10v5 M4 11v5h10v-5 M2 9h3m2 0h3m2 0h4'],
  area:['layout','M2 7V3h4m6 0h4v4m0 4v4h-4m-6 0H2v-4 M6 7h6v4H6z'],
  format:['layout','M2 5l7-3 7 3-7 3z M2 9l7 3 7-3 M2 13l7 3 7-3'],
  columns:['layout','M2 3h14v12H2z M7 3v12 M11 3v12'],
  column:['layout','M5 2h8v14H5z M8 5v8'],
  table:['grid','M2 3h14v12H2z M2 7h14 M2 11h14 M7 7v8 M11 7v8'],
  'table-row':['grid','M2 6h14v6H2z M7 6v6 M11 6v6'],
  'table-cell':['grid','M4 4h10v10H4z M7 7h4'],
  'row-group':['grid','M5 3H2v12h3 M7 4h9v4H7z M7 10h9v4H7z'],
  repeat:['data','M3 8V5h10l-3-3 M15 10v3H5l3 3'],
  'field-ref':['data','M7 3H6q-2 0-2 2v2q0 2-2 2 2 0 2 2v2q0 2 2 2h1 M11 3h1q2 0 2 2v2q0 2 2 2-2 0-2 2v2q0 2-2 2h-1'],
  'system-page-field':['data','M7 2L5 16 M13 2l-2 14 M3 7h13 M2 11h13'],
  'text-block':['text','M3 3h12v12H3z M6 6h6 M6 9h6 M6 12h4'],
  text:['text','M2 4h9 M6.5 4v10 M10 8h6 M13 8v6'],
  spacer:['layout','M3 2h12 M3 16h12 M9 5v8 M7 7l2-2 2 2 M7 11l2 2 2-2'],
  'line-break':['text','M15 4v6H4 M8 6l-4 4 4 4'],
  line:['text','M2 9h14 M2 7v4 M16 7v4'],
  image:['media','M2 3h14v12H2z M3 13l4-5 3 3 2-2 3 4 M11 6h1'],
  'table-of-contents':['text','M3 4h1m3 0h8 M3 9h1m3 0h8 M3 14h1m3 0h8'],
  link:['data','M7 11l4-4 M8 5l2-2a3 3 0 0 1 5 5l-2 2 M10 13l-2 2a3 3 0 0 1-5-5l2-2'],
};
export function treeIcon(kind:string){
  const [tone,path]=Object.hasOwn(glyphs,kind)?glyphs[kind]:['text','M9 2l7 7-7 7-7-7z'];
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('class','tree-kind-icon');icon.dataset.tone=tone;
  icon.setAttribute('viewBox','0 0 18 18');icon.setAttribute('aria-hidden','true');
  const shape=document.createElementNS(icon.namespaceURI,'path');
  shape.setAttribute('d',path);icon.append(shape);
  return icon;
}
