/** Independent full-cell oracle. Expected content comes from the fixture grammar, not frame snapshots. */
import {createRequire} from 'node:module'
import {readFileSync,realpathSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(resolve(dirname(realpathSync(resolve(root,'node_modules'))),'packages/terminal/terminal-bash/package.json'))
const {Terminal}=require('@xterm/headless')
const [prefix]=process.argv.slice(2)
const frames=readFileSync(prefix+'.frames.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
const capture=readFileSync(prefix+'.ansi')
const terminal=new Terminal({cols:frames[0].columns,rows:frames[0].rows,allowProposedApi:true,scrollback:0})
const result={frames:frames.length,compared:0,transitions:0,resizeRecovery:0,deferredPresentation:0,unmatched:0,failed:0,examples:[]}
let offset=0,columns=frames[0].columns,rows=frames[0].rows
let resizeTick=-Infinity,resizeFrames=0,resizePending=false
let lastPresentedTick=-1
const end=Buffer.from('\x1b[?2026l')
for(const frame of frames){
 const resize=frame.columns!==columns||frame.rows!==rows
 if(resize){columns=frame.columns;rows=frame.rows;terminal.resize(columns,rows);resizeTick=frame.expectedTick;resizeFrames=0;resizePending=true}
 const next=capture.indexOf(end,offset)
 if(next<0)throw new Error('Captured PTY has fewer completed frames than write metadata')
 const stop=next+end.length
 await new Promise(done=>terminal.write(capture.subarray(offset,stop),done));offset=stop
 const lines=Array.from({length:rows},(_,i)=>terminal.buffer.active.getLine(i).translateToString(false,0,columns))
 const tickMatch=lines[1].match(/^  TURN_(\d+) TICK_(\d+) ROW_0/)
 // Explicitly count incomplete mount/resize layout frames, never call them passes.
 if(resize){result.transitions++;continue}
 // Resize may emit clear, layout, then transcript as distinct completed writes.
 // Count these as uncomparable until a canonical frame after the resize tick, with a strict
 // two-tick/six-write deadline; persistent or unrelated corruption still fails.
 const recovery=resizePending&&++resizeFrames<=6&&frame.expectedTick-resizeTick<=2
 if(!tickMatch){
  if(result.compared===0&&result.transitions<2){result.transitions++;continue}
  if(recovery){result.transitions++;result.resizeRecovery++;continue}
  result.unmatched++;result.failed++;if(result.examples.length<5)result.examples.push({offset:frame.offset,error:'Missing canonical tick in a stable frame'});continue
 }
 if(!Number.isInteger(frame.expectedTick))throw new Error('Missing independent canonical tick metadata')
 // The fixture records canonical state at physical delivery. A frame already
 // in flight may represent the immediately preceding 100ms revision. Both
 // candidates come from the canonical log; never accept arbitrary output text
 // as the expected version. Regressions and a lag of two ticks still fail.
 const previous=frame.expectedTick-1
 const deferred=Number(tickMatch[2])===previous&&previous>=lastPresentedTick
 const tick=deferred?previous:frame.expectedTick
 const expected=['SOAK_GENERATING',...Array.from({length:rows-4},(_,i)=>`  TURN_${Math.floor(tick/25)} TICK_${tick} ROW_${i}`),'│ › SOAK_INPUT','│ > DRAFT','SOAK_STATUS active'].map(s=>s.padEnd(columns))
 const mismatches=[]
 if(tick<lastPresentedTick)mismatches.push({tick,previousTick:lastPresentedTick})
 for(let row=0;row<rows;row++){
  if(lines[row]!==expected[row])mismatches.push({row,actual:lines[row],expected:expected[row]})
  for(let col=0;col<columns;col++){
   const cell=terminal.buffer.active.getLine(row).getCell(col)
   const bg=row===rows-3||row===rows-2?0x23262b:0x151618
   if(cell.getBgColor()!==bg){mismatches.push({row,col,bg:cell.getBgColor(),expectedBg:bg});break}
  }
 }
 if(terminal.buffer.active.cursorX!==9||terminal.buffer.active.cursorY!==rows-2)mismatches.push({cursor:[terminal.buffer.active.cursorX,terminal.buffer.active.cursorY],expectedCursor:[9,rows-2]})
 if(recovery&&(mismatches.length||deferred)){result.transitions++;result.resizeRecovery++;continue}
 // A same-tick control write can still show the old valid frame before Ink
 // emits its resize layout. Keep the original six-write/two-tick budget open.
 if(frame.expectedTick>resizeTick)resizePending=false
 result.compared++
 if(mismatches.length){result.failed++;if(result.examples.length<5)result.examples.push({offset:frame.offset,mismatches:mismatches.slice(0,4)})}
 else {lastPresentedTick=tick;if(deferred)result.deferredPresentation++}
}
// A bounded in-flight revision cannot excuse a permanently stale final view.
if(lastPresentedTick!==frames.at(-1).expectedTick){result.failed++;result.examples.push({error:'Final presentation did not catch up',lastPresentedTick,expectedTick:frames.at(-1).expectedTick})}
terminal.dispose()
writeFileSync(prefix+'.oracle.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
if(result.failed||!result.compared)process.exitCode=1
