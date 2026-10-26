import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readdirSync,writeFileSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
const root=fileURLToPath(new URL('../..',import.meta.url)).replace(/\/$/,'')
const require=createRequire(root+'/tui-render/package.json')
const {createElement}=await import(require.resolve('react'))
const {renderToString}=await import(require.resolve('ink'))
const {InputBar}=await import(root+'/tui-render/src/input-bar.tsx')
const {wrapStdoutForFrameBg,setFrameCaret}=await import(root+'/tui-render/src/frame-fill.ts')
const {applyTheme}=await import(root+'/tui-render/src/theme.ts')
const {createFrameMetrics}=await import(root+'/tui-render/src/frame-metrics.ts')
const {createStreamQueue}=await import(root+'/tui-render/src/stream-queue.ts')
const store=root+'/node_modules/.pnpm'
const xterm=readdirSync(store).find(n=>n.startsWith('@xterm+headless@'))
const {Terminal}=require(store+'/'+xterm+'/node_modules/@xterm/headless')
applyTheme('truecolor','dark')
setFrameCaret(undefined)
const sgr='\x1b[48;2;21;22;24m'
async function replay(chunks,wrap){
 const output=[]
 const sink={isTTY:true,columns:80,rows:24,write(s){output.push(s);return true}}
 const stream=wrap?wrapStdoutForFrameBg(sink,()=> 'truecolor'):sink
 for(const c of chunks)stream.write(c)
 const terminal=new Terminal({cols:80,rows:24,allowProposedApi:true})
 for(const c of output)await new Promise(done=>terminal.write(c,done))
 const line=terminal.buffer.active.getLine(0).translateToString(true)
 terminal.dispose()
 return {line,output}
}
const result={node:process.version,ansi:{}}
const at=sgr.indexOf('1;22')
result.ansi.unsplitWrapped=await replay([sgr+'OK'],true)
result.ansi.splitDirect=await replay([sgr.slice(0,at),sgr.slice(at)+'OK'],false)
result.ansi.splitWrapped=await replay([sgr.slice(0,at),sgr.slice(at)+'OK'],true)
result.input=[]
renderToString(createElement(InputBar,{text:'warmup',commandMode:false,mentionMode:false}))
for(const n of [100,1000,10000]){
 const text='中文🙂abc'.repeat(n)
 const samples=[]
 for(let i=0;i<3;i++){
  const t=performance.now()
  renderToString(createElement(InputBar,{text,caretIndex:text.length,commandMode:false,mentionMode:false}))
  samples.push(performance.now()-t)
 }
 result.input.push({codeUnits:text.length,samplesMs:samples})
}
result.multiline=[]
for(const n of [10,100,1000]){
 const text=Array(n).fill('line 中文').join('\n')
 const t=performance.now()
 const rendered=renderToString(createElement(InputBar,{text,caretIndex:text.length,commandMode:false,mentionMode:false}))
 result.multiline.push({lines:n,ms:performance.now()-t,outputLines:rendered.split('\n').length})
}
const m=createFrameMetrics()
m.recordDeltaIngressToStdoutDrain(500)
for(let i=0;i<1000;i++)m.recordDeltaIngressToStdoutDrain(1)
const q=createStreamQueue()
q.noteDrain(m.snapshot().deltaIngressToStdoutDrainMs.max)
q.tick(0);q.tick(10000)
result.pressure={metric:m.snapshot().deltaIngressToStdoutDrainMs,mode:q.getMode(),queue:q.getStats(10000)}
writeFileSync('/tmp/dsh-tui-audit-20261023-probes.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
