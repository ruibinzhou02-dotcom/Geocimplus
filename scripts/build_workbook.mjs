import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const input=process.argv[2];
if(!input)throw new Error('Usage: node build_workbook.mjs reports/TIMESTAMP/workbook_data.json');
const out=path.dirname(input), data=JSON.parse(await fs.readFile(input,'utf8')), wb=Workbook.create();
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const literal=v=>{if(v===null||v===undefined)return null;if(typeof v==='object')v=JSON.stringify(v);return typeof v==='string'&&v.startsWith('=')?"'"+v:v;};
await fs.mkdir(path.join(out,'excel_previews'),{recursive:true});
let i=0;
for(const [name,rows] of Object.entries(data)){
 const sh=wb.worksheets.add(name), keys=[...new Set(rows.flatMap(Object.keys))];
 if(!keys.length){keys.push('说明');rows.push({说明:'未检出记录'});}
 const values=[keys,...rows.map(r=>keys.map(k=>literal(r[k])))];
 const range=sh.getRange(`A1:${col(keys.length-1)}${values.length}`);range.setNumberFormat('@');range.values=values;
 range.format.font={name:'Arial',size:11,color:'#303438'};range.format.rowHeight=42;range.format.columnWidth=24;range.format.wrapText=true;range.format.verticalAlignment='top';
 sh.getRange(`A1:${col(keys.length-1)}1`).format={fill:'#5938B5',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:40};
 keys.forEach((k,j)=>{
  const c=sh.getRange(`${col(j)}2:${col(j)}${values.length}`);
  if(/名称|路径|说明|依据|字段|类型|范围|样例|类别|CRS|源FID|sha256|记录|颜色|配套|变换/.test(k))c.format.columnWidth=/说明|依据|记录|路径|CRS|类别/.test(k)?48:30;
  if(/比例|占比/.test(k))c.setNumberFormat('0.00%');
  else if(/字节|数$|FID$|宽$|高$/.test(k))c.setNumberFormat('#,##0');
  else if(rows.some(r=>typeof r[k]==='number'&&!Number.isInteger(r[k])))c.setNumberFormat('0.##########');
  else if(rows.some(r=>typeof r[k]==='string'))c.setNumberFormat('@');
 });
 sh.getRange(`A2:${col(keys.length-1)}${values.length}`).format.autofitRows();
 sh.freezePanes.freezeRows(1);sh.showGridLines=false;
 const table=sh.tables.add(`A1:${col(keys.length-1)}${values.length}`,true,'AuditTable'+(++i));table.showFilterButton=true;
 const blob=await wb.render({sheetName:name,range:`A1:${col(Math.min(keys.length-1,5))}${Math.min(values.length,6)}`,scale:1.4,format:'png'});
 await fs.writeFile(path.join(out,'excel_previews',name+'.png'),new Uint8Array(await blob.arrayBuffer()));
}
console.log((await wb.inspect({kind:'table',range:'图层概览!A1:F5',include:'values,formulas',tableMaxRows:5,tableMaxCols:6,maxChars:1700})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!',options:{useRegex:true,maxResults:20},summary:'formula error scan'})).ndjson);
const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save(path.join(out,'数据体检表.xlsx'));
console.log('EXPORTED '+path.join(out,'数据体检表.xlsx'));
