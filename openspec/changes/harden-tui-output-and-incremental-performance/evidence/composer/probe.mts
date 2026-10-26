import { composerIndex } from '/home/zhangyangrui/my_programes/dsh-tui/tui-render/src/composer-index.ts'
import { moveInputSelection } from '/home/zhangyangrui/my_programes/dsh-tui/tui-render/src/input-selection.ts'
const text='👩‍💻x'
console.log(JSON.stringify({ staleCaretColumns:Array.from({length:5},(_,caret)=>({caret,column:composerIndex(text).line(0).window(caret,76).caretColumn,snapped:composerIndex(text).snapCaret(caret)})),crlfEnd:moveInputSelection({text:'a\r\nb',caretIndex:0},{direction:'end',extend:true})},null,2))
