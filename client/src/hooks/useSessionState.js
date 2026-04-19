import { useState, useCallback } from 'react';

function useSessionState(key,defaultVal){
  const [val,setVal]=useState(()=>{
    try{
      const s=sessionStorage.getItem(key);
      if(s==null)return defaultVal;
      return JSON.parse(s);
    }catch(e){return defaultVal;}
  });
  const setter=useCallback((v)=>{
    setVal(prev=>{
      const next=typeof v==="function"?v(prev):v;
      try{
        if(JSON.stringify(next)===JSON.stringify(defaultVal))sessionStorage.removeItem(key);
        else sessionStorage.setItem(key,JSON.stringify(next));
      }catch(e){/* quota / private mode */}
      return next;
    });
  },[key,defaultVal]);
  return[val,setter];
}
export { useSessionState };
