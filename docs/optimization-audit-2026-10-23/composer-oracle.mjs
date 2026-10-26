import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
const root=fileURLToPath(new URL('../..',import.meta.url)).replace(/\/$/,'')
const require=createRequire(root+'/package.json')
const store=root+'/node_modules/.pnpm'
const version=readdirSync(store).find(n=>n.startsWith('@xterm+headless@'))
const {Terminal}=require(store+'/'+version+'/node_modules/@xterm/headless')
const capture=readFileSync('/tmp/dsh-tui-audit-20261023-pty/capture.ansi')
const terminal=new Terminal({cols:80,rows:24,allowProposedApi:true,scrollback:0})
const end=Buffer.from('\x1b[?2026l')
const result={frames:0,composerFrames:0,missingComposerFrames:0,badComposerFrames:0,badCursorFrames:0,examples:[]}
let offset=0
for(;;){
 const at=capture.indexOf(end,offset);if(at<0)break
 await new Promise(done=>terminal.write(capture.subarray(offset,at+end.length),done));offset=at+end.length
 result.frames++
 const lines=Array.from({length:24},(_,i)=>terminal.buffer.active.getLine(i)?.translateToString(true)??'')
 const header=lines.findIndex(s=>s.includes('输入消息'))
 if(header<0){result.missingComposerFrames++;continue}
 result.composerFrames++
 const text=lines[header+1]
 const badText=text.trimEnd()!=='│ >'
 const badCursor=terminal.buffer.active.cursorY!==header+1||terminal.buffer.active.cursorX!==4
 if(badText)result.badComposerFrames++
 if(badCursor)result.badCursorFrames++
 if((badText||badCursor)&&result.examples.length<4)result.examples.push({frame:result.frames,text,cursor:[terminal.buffer.active.cursorX,terminal.buffer.active.cursorY],expected:[4,header+1]})
}
terminal.dispose()
writeFileSync('/tmp/dsh-tui-audit-20261023-pty/composer.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
