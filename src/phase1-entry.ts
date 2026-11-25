if(new URLSearchParams(location.search).get('trial')==='one-line'){
  void import('./one-line-paper');
}else{
  void import('./phase1-editor');
}
export {};
