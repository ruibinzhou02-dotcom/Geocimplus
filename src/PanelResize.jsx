import {useEffect,useRef} from 'react';
export const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function usePointerDrag(){
 const cleanup=useRef(()=>{});
 useEffect(()=>()=>cleanup.current(),[]);
 return (event,move,end=()=>{})=>{
  if(event.button!==0)return;
  event.preventDefault();cleanup.current();
  const x=event.clientX,y=event.clientY,id=event.pointerId;
  const onMove=e=>{if(e.pointerId===id)move(e.clientX-x,e.clientY-y,e);};
  const stop=e=>{if(e.pointerId!==id)return;cleanup.current();end(e);};
  cleanup.current=()=>{window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};
  window.addEventListener('pointermove',onMove);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',stop);
 };
}
