/** Mixed prose and identifiers from a five-column preset comparison. */
export const PRESET_TABLE_CELLS = [
  ['', 'standard', 'minimal', 'ptc', 'cordis'],
  ['persona', '默认编码 agent', '固定一句话，complete: true', '= standard', '元提示（自我指涉）'],
  ['工具面', '全量（约 20+ 行）', '仅 2 个：持久 shell + 编辑器', '= standard', '= standard + tool-cordis'],
  ['shell', '一次性 bash/pwsh', '持久 PTY 栈（isolate: terminals）', '一次性', '一次性'],
  ['fs', 'host 沙箱', '裸本地（isolate: fs）', 'host 沙箱', 'host 沙箱'],
  ['compaction / plan / goals / skills', '有', '全部无', '有', '有（+ 自带技能目录）'],
  ['额外', '—', 'includeRuntimeContext: false', 'tool-presentation (mode: ptc)', '可读写自身运行时'],
  ['信任等级', '普通', '最受限', '普通', '视同 shell 权限'],
] as const

/** GFM source for renderer and assembled-terminal expectations. */
export const PRESET_TABLE_MARKDOWN = PRESET_TABLE_CELLS.map((row, index) => {
  const source = `| ${row.join(' | ')} |`
  return index === 0 ? `${source}\n| --- | --- | --- | --- | --- |` : source
}).join('\n')
