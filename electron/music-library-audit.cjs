'use strict';
// Pure audit of saved media references. No filesystem mutation, ever.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const ALLOWED = new Set(['.aac','.aiff','.avi','.flac','.m4a','.mkv','.mov','.mp3','.mp4','.m4v','.mpeg','.mpg','.ogg','.opus','.wav','.webm','.wmv','.wma']);
const MAX_ITEMS = 12000;
function checkLocal(item, stat = fs.statSync) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {status:'invalid', reason:'Invalid stored entry'};
  const src = String(item.source || 'local').toLowerCase();
  const raw = String(item.url || '').trim();
  if (!raw) return src === 'local' ? {status:'invalid',reason:'Missing saved file URL'} : {status:'skipped',reason:'Nonlocal source'};
  let url;
  try { url = new URL(raw); }
  catch { return src === 'local' ? {status:'invalid',reason:'Malformed file URL'} : {status:'skipped',reason:'Nonlocal source'}; }
  if (url.protocol !== 'file:') return {status:'skipped',reason:'Network/stream entry not scanned'};
  let filename;
  try { filename=fileURLToPath(url); }
  catch { return {status:'invalid',reason:'Malformed local file URL'}; }
  if (!ALLOWED.has(path.extname(filename).toLowerCase())) return {status:'invalid',reason:'Unsupported media file extension'};
  try {
    const file=stat(filename);
    if (!file.isFile()) return {status:'invalid',reason:'Not a regular media file'};
    if (file.size===0) return {status:'invalid',reason:'Empty media file'};
    return {status:'valid',reason:''};
  } catch(error) {
    // EACCES and EIO do not mean the file is missing: never mark for removal.
    if (error && error.code==='ENOENT') return {status:'invalid',reason:'File does not exist'};
    if (error && error.code==='ENOTDIR') return {status:'invalid',reason:'Parent directory does not exist'};
    return {status:'unknown',reason:'Could not verify local file; left untouched'};
  }
}
function audit(items,stat=fs.statSync) {
  if (!Array.isArray(items) || items.length>MAX_ITEMS) throw new Error('Library audit exceeds safe item limit');
  const results=items.map((item,index)=>{
    const r=checkLocal(item,stat);
    return {index,status:r.status,reason:r.reason,url:String(item?.url||'').slice(0,2048),
      id:typeof item?.id==='string'||typeof item?.id==='number'?String(item.id).slice(0,120):''};
  });
  return {total:results.length,invalid:results.filter(x=>x.status==='invalid'),
    unknown:results.filter(x=>x.status==='unknown').length,
    valid:results.filter(x=>x.status==='valid').length,
    skipped:results.filter(x=>x.status==='skipped').length};
}
module.exports={audit,checkLocal,MAX_ITEMS};
