/** Editable composer actions and the context-specific terminal shortcut directory. */
import type { BrowserRow } from './browser-pane.tsx'

const actions = [
  ['toggle-reasoning', 'o', '思考内容'], ['toggle-tool-cards', 'e', '工具卡片'],
  ['copy-message', 'y', '复制选区或最近消息'], ['agent-hub', 'b', '子代理'],
  ['intake-clipboard-image', 'p', '粘贴图片'], ['edit-external', 'g', '外部编辑器'],
  ['new-session', 'n', '新会话'], ['toggle-timeline', 't', '事件时间线'],
] as const
export type ShortcutOverrides = Readonly<Record<string, string>>
export const EMPTY_SHORTCUTS: ShortcutOverrides = Object.freeze({})

export function shortcutBindings(overrides: ShortcutOverrides): ReadonlyMap<string, string> {
  for (const key of Object.keys(overrides)) {
    if (!actions.some(([id]) => id === key)) throw new Error(`未知动作：${key}`)
  }
  const result = new Map<string, string>()
  const used = new Set<string>()
  for (const [id, key] of actions) {
    const chord = overrides[id] ?? `Ctrl+${key.toUpperCase()}`
    if (chord === 'none') { result.set(id, chord);continue }
    if (!/^Ctrl\+[A-Z]$/u.test(chord) || /^[ACDHIJKMUWV]$/u.test(chord.slice(-1))) {
      throw new Error(`保留的终端/编辑按键或不支持的组合：${chord}`)
    }
    if (used.has(chord)) throw new Error(`快捷键冲突：${chord}`)
    used.add(chord);result.set(id, chord)
  }
  return result
}

/** Return the original key understood by the composer, or swallow a released chord. */
export function remapShortcut(key: string, overrides: ShortcutOverrides): string | undefined {
  const bindings = shortcutBindings(overrides)
  const chord = `Ctrl+${key.toUpperCase()}`
  const action = actions.find(([id]) => bindings.get(id) === chord)
  if (action !== undefined) return action[1]
  return actions.some(([, original]) => key === original) ? undefined : key
}

export function shortcutCatalog(overrides: ShortcutOverrides): readonly BrowserRow[] {
  const bindings = shortcutBindings(overrides)
  return [
    ...actions.map(([id, , title]) => ({ id, title: `${id} · ${title}`, hint: `${bindings.get(id)} · /bind ${id} Ctrl+R · /unbind ${id}` })),
    { id: 'send', title: '发送与模式', hint: 'Enter 发送 · Shift+Enter 换行 · submitOnEnter=false 时 Ctrl+Enter 发送 · Shift+Tab agent/plan/focus' },
    { id: 'stop', title: '停止与退出', hint: 'Ctrl+C 停止正在运行的回合；空闲时连按两次退出 · Esc 关闭当前面板' },
    { id: 'editor', title: '输入编辑/选择', hint: '←→/Home/End 移动 · Shift+←→/Home/End 选择 · Ctrl+Y 复制 · Ctrl+U/W 清行/删词 · ↑↓ 历史 · Tab 补全 /命令/@文件' },
    { id: 'history', title: '对话阅读', hint: '空输入 j/k、↑↓、PgUp/PgDn 滚动 · gg/G 首尾 · Ctrl+K 搜索/压缩分隔 · Ctrl+T 事件' },
    { id: 'settings', title: '设置', hint: '↑↓ 选择 · Tab/Shift+Tab 分组 · Enter 编辑 · Space 切换 · e 导出/r 重载 · 编辑时 Enter 保存、Esc 取消' },
    { id: 'browser', title: '事件/附件/review/目录', hint: '↑↓/jk/PgUp/PgDn 选择/阅读 · Home/End 首尾 · Enter 详情 · r 刷新 · Esc 返回 · o 打开本地附件' },
    { id: 'chords', title: '空输入组合键', hint: 'g a 子代理 · g t 文件树 · g p 插件 · g f 反馈 · g w 工作流 · g g 顶部；600ms 内输入第二键' },
    { id: 'permissions', title: '权限/反馈/计划', hint: '权限 ↑↓/1/2/3 选择、Enter 应用 · 反馈 l/d 好评/差评、e 备注 · 计划目录 ↑↓/Enter 选择' },
    { id: 'account', title: '账号', hint: 'Enter 登录 · k API key · o 打开验证页 · c 取消登录 · x 退出账号 · y/n 确认/保留' },
    { id: 'sessions', title: '会话/文件/子代理', hint: '↑↓/jk 选择 · Enter 打开 · Esc 返回 · 会话 r 重命名/d 删除/y 确认 · 文件 i 插入路径/e 改目录/o 系统打开/r 刷新 · 子代理 s 停止/c 续聊/v 并排；续聊 Enter 排队、Ctrl+Enter 引导' },
    { id: 'blocking', title: '审批/提问/计划审阅', hint: 'Alt+H 只读帮助 · 审批 y/a 允许、n/d/Esc 拒绝、i 详情 · 提问 ↑↓、Space 多选、Enter 回答、c 自定义、i 详情 · 计划 ↑↓/Enter 审阅' },
    { id: 'plugins', title: '插件/定时提醒/工具详情', hint: '插件 i 安装、Space 启停、d 删除、a 批准、r 重试、R 重载 · 定时 r 刷新/d 删除/y 确认 · 工具 Enter/n/p/d/y/e 详情/前后/诊断/复制/导出' },
    { id: 'ime', title: 'IME / 屏幕阅读器', hint: '终端原生预编辑；支持 Ctrl+Enter 发送的终端可关闭 submitOnEnter · INK_SCREEN_READER=true 启用普通流、无鼠标和无动画' },
  ]
}
