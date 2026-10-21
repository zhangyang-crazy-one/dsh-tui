import { TerminalBrowser } from '../../../tui/src/browser.ts'
/** Real-PTY UI fixture: synthetic service snapshots, production TuiLoop and input routing. */
import { writeFileSync } from 'node:fs'
import { createElement, Profiler } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountTuiRender, TuiLoop, type TuiController, type ViewModel } from '../../src/index.ts'
import { EMPTY_APPROVAL_PANE } from '../../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE, type AskUserPaneState } from '../../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE, type SettingsPaneState } from '../../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../../src/overlay-shell.tsx'
import type { AgentHubPaneState } from '../../src/agent-hub-pane.tsx'
import type { TodoHudItem } from '../../src/todo-hud.tsx'
import type { JobHudItem } from '../../src/jobs-hud.tsx'
import type { WorkspacePaneState } from '../../src/workspace-pane.tsx'
import { EMPTY_SCHEDULE_PANE, type SchedulePaneState } from '../../src/schedule-pane.tsx'
import { PASSIVE_CONTROLLER } from '../helpers.ts'

const scene = process.argv[2]
const statsPath = process.argv[3]
if (!scene || !statsPath) throw new Error('Usage: ux-pty.tsx SCENE STATS_PATH')
const listeners = new Set<() => void>()
const stats = { commits: 0, snapshots: 0, actions: [] as string[], copied: '', sent: '', childSent: '', childDelivery: '' }
const notify = () => { for (const listener of listeners) listener() }
const browser = new TerminalBrowser(notify)
if (scene === 'browser') browser.open({ id: 'events', title: '事件来源与 JSON', load: async () => Array.from({ length: 100 }, (_, index) => ({ id: String(index), title: `EVENT_${String(index).padStart(3, '0')}`, hint: '工具 · 120 tok · 8 ms' })), detail: async row => `完整事件 ${row.id}\n${'JSON source row\n'.repeat(100)}END_EVENT_JSON` })
const model: ViewModel = {
  history: [{ id: 1, timestamp: Date.UTC(2026, 9, 20), kind: 'user', text: '检查终端中的密钥选择、子代理、完整任务清单与决策卡片。' }],
  activeTurn: undefined, status: 'generating', reasoningExpanded: false, toolCardsExpanded: false,
}
const deliveryFiles = Array.from({ length: 24 }, (_, index) => ({
  path: `/fixture/交付_${String(index).padStart(3, '0')}.md`, description: `完整报告 ${index}`,
}))
if (scene === 'deliveries') model.history = [...model.history, {
  id: 2, timestamp: Date.UTC(2026, 9, 20), kind: 'assistant', text: '报告已交付，可用 /deliveries 查看。',
  presentedFiles: deliveryFiles.slice(0, 2),
}]
let workspace: WorkspacePaneState = {
  open: scene === 'deliveries', mode: 'deliveries', root: '', selectedIndex: 0, editing: false,
  nodes: deliveryFiles.map(file => ({ ...file, name: file.path, depth: 0, kind: 'file', expanded: false })),
}
let previewPageRows = 1
let previewMaxOffset = 0
let schedules: SchedulePaneState = { ...EMPTY_SCHEDULE_PANE, open: scene === 'schedules',
  rows: Array.from({ length: 1000 }, (_, index) => ({
    id: `reminder-${index}`, sessionId: 'original-session', title: `REMINDER_${String(index).padStart(4, '0')} 核对报告`,
    prompt: '检查原会话中的文件和验证记录，保留任务约束。\n'.repeat(100) + 'END_REMINDER',
    timing: '每天 12:00 · Asia/Shanghai', scheduledAt: '2026-10-20T04:00:00Z', active: true,
  })),
}
const closedSession: ReturnType<TuiController['getSessionPane']> = { rows: [], selectedIndex: 0, open: false, confirmDelete: false, deleteUnavailable: false, currentId: undefined }
const closedSearch: ReturnType<TuiController['getSearchPane']> = { query: '', results: [], selectedIndex: 0, open: false, status: 'idle' }
const closedModel: ReturnType<TuiController['getModelPane']> = { open: false, filter: '', rows: [], selectedIndex: 0, status: 'idle' }
const closedHelp = { open: false, lines: [] }
const goal = { phase: 'active', objective: '长任务中的操作项保持可见，完整文案可以翻页阅读', roundsStarted: 4, maxGoalRounds: 40 }
const todos: readonly TodoHudItem[] = Array.from({ length: 2000 }, (_, index) => ({
  content: `TODO_${String(index).padStart(4, '0')} ${index % 17 === 0 ? '核对长条目：包含中文、多行细节与验证结果，保持顺序，完整展示并可翻页。\n这是同一条任务的补充信息。' : '逐项验证交互、显示与性能'}`,
  status: index < 9 ? 'completed' : index === 9 ? 'in_progress' : 'pending',
}))
const childRows = [
  { id: SessionId('fixture-child-1'), label: '渲染检查', activity: 'running', hasChildren: true, mode: 'continuable' as const, parentSessionId: SessionId('fixture-parent'),
    task: '排查长命令审批卡片与终端增量刷新', summary: '已复现最后一列字符丢失，正在检查适配层', execution: '运行中', tokens: 1450, contextPercent: 12, durationMs: 12000, model: 'fixture/model' },
  { id: SessionId('fixture-child-2'), label: '交互检查', activity: 'running', hasChildren: false, mode: 'continuable' as const, parentSessionId: SessionId('fixture-parent'),
    task: '检查待办清单翻页和主会话草稿', summary: '正在验证 2000 条任务的有界显示', execution: '运行中', tokens: 920, contextPercent: 8, durationMs: 9000, model: 'fixture/model' },
]
let hub: AgentHubPaneState = { open: scene === 'agents' || scene === 'split' || scene === 'child', rows: childRows, selectedIndex: 0, view: 'table', liveContinuable: 2, maxActiveSubagents: 8, maxDepth: 2 }
if (scene === 'child') hub = { ...hub, prompt: 'CHILD_DRAFT', caretIndex: 11 }
if (scene === 'split') hub = { ...hub, split: true, view: 'transcript', scrollOffset: Number.MAX_SAFE_INTEGER, transcript: 'CHILD_VISIBLE\n' + '子代理记录 · 中日韩和窄列换行验证。'.repeat(60) + '\nCHILD_END' }
const jobs: readonly JobHudItem[] = childRows.map(row => ({ id: row.id, displayName: row.label, status: 'running', label: `Ctrl+B 查看 · ${row.task}` }))
let settings: SettingsPaneState = {
  ...EMPTY_SETTINGS_PANE, open: scene === 'key' || scene === 'secret', onboarding: true,
  rows: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'CUSTOM_VENDOR_API_KEY'].map((field, index) => ({ namespace: 'credentials', field, value: '未设置', label: `${['DeepSeek', 'OpenAI', '自定义 Provider'][index]} · ${field}`, editValue: '' })),
}
let todoOpen = scene === 'todos'
let approval = { ...EMPTY_APPROVAL_PANE, requestId: 1, open: scene === 'approval', toolName: 'bash',
  reason: '需要确认这条操作；全文阅读不改变批准状态。',
  arguments: JSON.stringify({ command: `# Review the complete command before approving\n${'printf "完整命令与中文参数\\n"\n'.repeat(100)}# END_APPROVAL`, cwd: '/fixture/workspace' }) }
let question: AskUserPaneState = { ...EMPTY_ASK_USER_PANE, requestId: 2, open: scene === 'question' || scene === 'question-custom',
  header: `${'这是一段很长的任务说明，明确列出本次操作涉及的范围、约束和验证条件。'.repeat(80)} END_QUESTION`,
  options: ['采用建议方案并保留现有改动', '先阅读完整说明，然后调整方案', '取消本次操作'], selectedIndex: 0 }
if (scene === 'question-custom' || scene === 'help') question = { ...question, header: '选择需要的修改（支持多选和补充回答）',
  detail: '完整问题说明：保留主会话和草稿，完成验证。\n'.repeat(100) + 'END_CUSTOM_PROMPT',
  multiSelect: true, selectedIndices: [],
}
let plan = { open: scene === 'plan', requestId: 3, plan: `# 实施计划\n\n${'先验证源码、再运行针对性回归，最后检查实际终端截图与性能数据。'.repeat(120)} END_PLAN\n\n- 保留草稿与主会话\n- 逐项检查显示边界\n- 完成后记录证据` }
if (scene === 'help') question = { ...question, open: true, editingCustom: true, customText: 'ANSWER_DRAFT', customCaretIndex: 12 }
const controller: TuiController = {
  ...PASSIVE_CONTROLLER,
  getModel: () => model, getInteraction: () => 'generating', getTitle: () => 'TUI 交互验证', getBadge: () => 'PTY fixture',
  getComposerDraft: () => scene === 'palette' ? '' : scene === 'selection' ? '选择中🙂' : '草稿保留 DRAFT_PRESERVED',
  getSessionPane: () => closedSession, getSearchPane: () => closedSearch,
  getModelPane: () => closedModel, getHelpPane: () => closedHelp, getTimelineOpen: () => false,
  getApprovalPane: () => approval, getAskUserPane: () => question, getPlanReviewPane: () => plan,
  getPermissionPane: () => EMPTY_PERMISSION_PANE, getSettingsPane: () => settings,
  getAgentHubPane: () => hub, getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
  getWorkspacePane: () => workspace,
  getBrowserPane: () => browser.get(),
  copySelection: text => { stats.copied = text;notify() },
  getSchedulePane: () => schedules,
  getTodoPaneOpen: () => todoOpen, getTodoHud: () => todos, getJobsHud: () => jobs,
  getGoalFooter: () => ['approval', 'question', 'plan'].includes(scene) ? goal : undefined,
  getComposerHud: () => undefined, getToolPresenters: () => undefined, getSubmitOnEnter: () => true,
  getFeedback: () => undefined, getCwd: () => '/fixture/workspace', listMentions: async () => [],
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  commands: [{ name: 'key', description: '选择已配置 Provider 的密钥名称' }, ...settings.rows.map(row => ({ name: `key ${row.field}`, description: row.label ?? row.field })), { name: 'agents', description: '查看子代理实时进度' }, { name: 'todos', description: '展开当前回合完整任务清单' }],
  dispatch: action => {
    stats.actions.push(action.kind)
    switch (action.kind) {
      case 'browser-move': browser.move(action.delta);break
      case 'browser-offset': browser.offset(action.offset);break
      case 'browser-enter': browser.enter();break
      case 'browser-back': browser.back();break
      case 'browser-refresh': browser.refresh();break
      case 'send': stats.sent = action.text;break
      case 'agent-hub-control':
        if (action.input === 'split') hub = { ...hub, split: !hub.split }
        else if (action.input === 'edit') hub = { ...hub, prompt: action.text, caretIndex: action.caretIndex }
        else if (action.input === 'queue' || action.input === 'steer') { stats.childSent = hub.prompt ?? '';stats.childDelivery = action.input;hub = { ...hub, prompt: undefined, notice: '已接收续聊请求' } }
        else if (action.input === 'stop') hub = { ...hub, notice: '已请求停止，等待事件' }
        else if (action.input === 'cancel') hub = { ...hub, prompt: undefined }
        break
      case 'schedule-move': schedules = schedules.details
        ? { ...schedules, offset: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, schedules.offset + action.delta)) }
        : { ...schedules, selectedIndex: Math.max(0, Math.min(schedules.rows.length - 1, schedules.selectedIndex + action.delta)) };break
      case 'schedule-offset': schedules = { ...schedules, offset: action.offset };break
      case 'schedule-enter': schedules = { ...schedules, details: true, offset: 0 };break
      case 'schedule-delete': schedules = { ...schedules, confirmDelete: true };break
      case 'schedule-confirm': schedules = { ...schedules, confirmDelete: false };break
      case 'schedule-escape': schedules = schedules.details ? { ...schedules, details: false, offset: 0 } : { ...schedules, open: false };break
      case 'workspace-move':
        if (workspace.preview !== undefined) workspace = { ...workspace, preview: { ...workspace.preview,
          scrollOffset: Math.max(0, Math.min(previewMaxOffset, workspace.preview.scrollOffset + action.delta * (action.unit === 'page' ? previewPageRows : 1))),
        } }
        else workspace = { ...workspace, selectedIndex: Math.max(0, Math.min(workspace.nodes.length - 1, workspace.selectedIndex + action.delta * (action.unit === 'page' ? 20 : 1))) }
        break
      case 'workspace-preview-layout': previewPageRows = action.layout.pageRows;previewMaxOffset = action.layout.maxOffset;break
      case 'workspace-enter': {
        const file = deliveryFiles[workspace.selectedIndex]
        if (file !== undefined) workspace = { ...workspace, preview: {
          path: file.path, name: file.path.split('/').at(-1) ?? '', scrollOffset: 0,
          lines: Array.from({ length: 80 }, (_, index) => `正文 ${String(index).padStart(3, '0')} · 验证中文与长行的完整阅读。`),
        } }
        break
      }
      case 'workspace-escape': workspace = workspace.preview === undefined ? { ...workspace, open: false } : { ...workspace, preview: undefined };break
      case 'todo-pane': todoOpen = !todoOpen; break
      case 'agent-hub': hub = { ...hub, open: !hub.open }; break
      case 'agent-hub-move':
        if (hub.view === 'transcript') hub = { ...hub, scrollOffset: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, (hub.scrollOffset ?? 0) + action.delta)) }
        else hub = { ...hub, selectedIndex: Math.max(0, Math.min(childRows.length - 1, (hub.selectedIndex ?? 0) + action.delta)) }
        break
      case 'agent-hub-enter': hub = { ...hub, view: 'transcript', scrollOffset: Number.MAX_SAFE_INTEGER, transcript: Array.from({ length: 60 }, (_, i) => `子代理记录 ${String(i).padStart(2, '0')} · 正在核对公开输出和工具执行结果。`).join('\n') }; break
      case 'agent-hub-escape': hub = hub.view === 'transcript' ? { ...hub, split: false, view: 'table' } : { ...hub, open: false }; break
      case 'settings-move': settings = { ...settings, selectedIndex: Math.max(0, Math.min(settings.rows.length - 1, settings.selectedIndex + action.delta)) }; break
      case 'settings-edit': settings = { ...settings, editing: true }; break
      case 'settings-escape': settings = { ...settings, open: false, editing: false }; break
      case 'settings-cancel-edit': settings = { ...settings, editing: false }; break
      case 'approval-detail': approval = { ...approval, detailsOpen: !approval.detailsOpen }; break
      case 'approval-allow': case 'approval-deny': approval = { ...approval, open: false }; break
      case 'ask-user-digit': question = { ...question, selectedIndex: action.index }; break
      case 'ask-user-move': question = { ...question, selectedIndex: Math.max(0, Math.min(question.options.length - 1, question.selectedIndex + action.delta)) }; break
      case 'ask-user-toggle': question = { ...question, selectedIndices: question.selectedIndices?.includes(question.selectedIndex)
        ? question.selectedIndices.filter(index => index !== question.selectedIndex) : [...question.selectedIndices ?? [], question.selectedIndex] };break
      case 'ask-user-custom': question = { ...question, editingCustom: true, customText: '', customCaretIndex: 0 };break
      case 'ask-user-custom-edit': question = { ...question, customText: action.text, customCaretIndex: action.caretIndex };break
      case 'ask-user-custom-save': case 'ask-user-custom-cancel': question = { ...question, editingCustom: false };break
      case 'ask-user-submit': case 'ask-user-cancel': question = { ...question, open: false }; plan = { ...plan, open: false }; break
      case 'plan-review-approve': case 'plan-review-keep': plan = { ...plan, open: false }; break
      case 'command':
        if (action.query.startsWith('key')) settings = { ...settings, open: true, editing: false }
        break
    }
    notify()
  },
}
const dispose = mountTuiRender(createElement(Profiler, {
  id: 'ux-pty', onRender: () => { stats.commits += 1 }, children: createElement(TuiLoop, { title: '交互验证', controller }),
}), { appearance: scene === 'light' ? 'light' : 'dark', env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
const save = () => {
  stats.snapshots += 1
  writeFileSync(statsPath, JSON.stringify({ ...stats, todoOpen, browserSelected: browser.get().selectedIndex, browserOpen: browser.get().open, browserOffset: browser.get().offset, childPrompt: hub.prompt, hubNotice: hub.notice, hubSplit: hub.split, hubView: hub.view, hubOpen: hub.open, settingsOpen: settings.open, selectedSetting: settings.selectedIndex, approvalOpen: approval.open, questionOpen: question.open, questionCustom: question.customText, questionSelections: question.selectedIndices, questionEditing: question.editingCustom, planOpen: plan.open, workspaceOpen: workspace.open, workspaceSelection: workspace.selectedIndex, workspacePreview: workspace.preview !== undefined, schedulesOpen: schedules.open, scheduleSelection: schedules.selectedIndex, scheduleOffset: schedules.offset }))
}
process.on('SIGUSR2', save)
process.once('SIGTERM', () => { save(); dispose(); process.exit(0) })
