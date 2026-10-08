import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const mock = `
const callbacks = new Map(); const listeners = new Map(); const sessions = new Map(); let nextSession=10; let callbackId=0;
const emit = (event,payload) => { for (const [id,listener] of listeners) if(listener.event===event) callbacks.get(listener.handler)?.({event,id,payload}); };
let clipboard = 'Good design makes everyday things feel effortless.';
let cfg={configVersion:3,engineMode:'local',providers:[],settings:{subtitle:{fps:5,mode:'ocr-first',engine:'rapid',region:{x:20,y:30,w:400,h:100}}}};
try { cfg=JSON.parse(localStorage.getItem('yike-ui-preview-config')) || cfg; } catch {}
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:(cb)=>{callbacks.set(++callbackId,cb);return callbackId;},unregisterCallback:id=>callbacks.delete(id),invoke:async(cmd,args)=>{
 if(cmd==='load_app_config'){await new Promise(r=>setTimeout(r,80));return structuredClone(cfg);}
 if(cmd==='save_app_config'){cfg=structuredClone(args.config);localStorage.setItem('yike-ui-preview-config',JSON.stringify(cfg));return;}
 if(cmd==='audio_subtitle_start') {
   const source=args.source, session=++nextSession; sessions.set(source,session);
   setTimeout(()=>emit('audio-status',{source,session,status:'loading'}),30);
   setTimeout(()=>emit('audio-status',{source,session,status:'ready'}),60);
   setTimeout(()=>emit('audio-partial',{source,session,id:session+':0',text:'第一句'}),150);
   setTimeout(()=>emit('audio-final',{source,session,id:session+':0',text:'第一句定稿'}),250);
   setTimeout(()=>emit('audio-partial',{source,session,id:session+':1',text:'第二句'}),350);
   return;
 }
 if(cmd==='audio_subtitle_stop') { const source=args.source; emit('audio-status',{source,session:sessions.get(source),status:'stopped'}); return; }
 if(cmd==='component_status') return {ocr:{installed:true},asr:{multi:{installed:true},ko:{installed:true}},denoise:{installed:false}};
 if(cmd==='audio_get_sensitivities') return {auto:.6,zh:.6,en:.6,ja:.6,ko:.6};
 if(cmd==='api_chat') {if(args.messages[0].content.includes('error'))throw 'API 401: mock invalid key'; const ch=args.onToken; ch.onmessage(JSON.stringify({c:'模拟 API 译文'}));return '模拟 API 译文';}
 if(cmd==='api_chat_full') return '模拟 API 译文';
 if(cmd==='plugin:window|is_maximized')return false;
 if(cmd==='plugin:event|listen'){const id=++callbackId;listeners.set(id,args);return id;}
 if(cmd==='plugin:event|unlisten'){listeners.delete(args.eventId);return;}
 if(cmd==='plugin:clipboard-manager|read_text')return clipboard;
 if(cmd==='plugin:clipboard-manager|write_text'){clipboard=args.text;return;}
 return null;
}};
const realFetch=window.fetch.bind(window);
window.fetch=async(url,opts)=>{
 if(String(url).startsWith('http://127.0.0.1:11434')){
  if(String(url).endsWith('/api/tags'))return new Response(JSON.stringify({models:[{name:'maternion/hy-mt2:1.8b',size:1100000000},{name:'gemma3:4b',size:3300000000}]}),{headers:{'Content-Type':'application/json'}});
  if(String(url).endsWith('/api/generate')){const body=JSON.parse(opts.body); await new Promise(r=>setTimeout(r,1200)); if(body.prompt.includes('error'))throw new Error('mock connection failed'); if(body.stream){return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({response:'模拟译文',done:true})+'\\n'));c.close();}}));}return new Response(JSON.stringify({response:'模拟译文'}));}
  return new Response('{}');
 }
 return realFetch(url,opts);
};`;
const server=await createServer({root,server:{host:'127.0.0.1',port:1427,strictPort:true},plugins:[{name:'audit-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/__audit'))return next();const html=await server.transformIndexHtml(req.url,`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>译刻 UI preview (mock)</title><script>${mock}</script></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`);res.setHeader('Content-Type','text/html');res.end(html);});}}]});await server.listen();console.log('Mock UI preview: http://127.0.0.1:1427/__audit (no real IPC, clipboard or inference)');
