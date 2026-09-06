// Export the displayed map without sending pixels or imported files to a server.
export async function exportMapPNG(map,{title,note,stats,lang,color}){
 if(!map.loaded())throw new Error(lang==='en'?'Wait for the map to finish loading.':'请等待地图加载完成后再导出。');
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{map.off('render',done);reject(new Error('Map render timed out.'));},5000);const done=()=>{clearTimeout(timer);resolve();};map.once('render',done);map.triggerRepaint();});
 const source=map.getCanvas(),canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');
 ctx.fillStyle='#F4F5F3';ctx.fillRect(0,0,1920,1080);
 // Fit without cropping: all features in the current view stay visible.
 const scale=Math.min(1920/source.width,920/source.height),w=source.width*scale,h=source.height*scale;
 ctx.drawImage(source,(1920-w)/2,90+(920-h)/2,w,h);
 ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,1920,90);ctx.fillRect(0,1010,1920,70);
 ctx.fillStyle='#7659C8';ctx.font='bold 28px Arial, Microsoft YaHei';ctx.fillText('GeoCIM',32,53);
 ctx.fillStyle='#30343A';ctx.font='26px Arial, Microsoft YaHei';ctx.fillText(title,205,53);
 ctx.font='20px Arial, Microsoft YaHei';ctx.fillText(note,1500,53);ctx.fillText(stats,32,1050);
 if(color==='height'){const colors=['#C4B7E5','#9C83D6','#7659C8','#5938B5','#372164'],labels=['0–30','30–60','60–100','100–200','200+ m'];ctx.font='16px Arial, Microsoft YaHei';colors.forEach((c,i)=>{ctx.fillStyle=c;ctx.fillRect(1210+i*135,1025,24,24);ctx.fillStyle='#30343A';ctx.fillText(labels[i],1240+i*135,1044);});}
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG export failed.');
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`GeoCIM-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
