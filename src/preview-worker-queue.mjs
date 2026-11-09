// Allow an active revision to reach the paper even during sustained input.
// Waiting revisions are replaced before they can consume layout time.
export function createPreviewQueue(layout,publish,discard=()=>{}){
  let latest=-1,active=false,pending;
  return {
    async submit(job){
      if(job.revision<=latest)return;
      latest=job.revision;
      if(pending)discard(pending);
      pending=job;
      if(active)return;
      active=true;
      try{
        while(pending){
          const next=pending;
          pending=undefined;
          let value,error;
          try{value=await layout(next);}catch(cause){error=cause;}
          publish(next,value,error);
        }
      }finally{active=false;}
    },
  };
}
