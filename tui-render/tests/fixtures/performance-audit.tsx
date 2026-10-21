/** Offline audit fixture: production TuiLoop/mount, synthetic service snapshots. */
import { writeFileSync } from 'node:fs'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { createElement, Profiler } from 'react'
import { mountTuiRender, TuiLoop, type TuiController, type ViewModel } from '../../src/index.ts'
import { createFrameMetrics } from '../../src/frame-metrics.ts'
import { visibleFrameSnapshot } from '../../src/frame-snapshot.ts'
import { renderPolicyDefaults } from '../../src/render-policy.ts'
import { EMPTY_APPROVAL_PANE } from '../../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE, type SettingsPaneState } from '../../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../../src/overlay-shell.tsx'
import { SettingsNavigation, settingsTreeFromDescribe, atPath } from '../../../tui/src/settings-navigation.ts'
import { parseSettingsFieldValue } from '../../../tui/src/settings-rows.ts'
import { PASSIVE_CONTROLLER } from '../helpers.ts'

const [statsPath, scene = 'chat', countText = '500', variant = 'default'] = process.argv.slice(2)
if (!statsPath) throw new Error('Usage: renderer-probe.tsx STATS_PATH SCENE COUNT [default|direct]')
const count = Number(countText)
const streaming = scene === 'stream' || scene === 'overlap' || scene === 'live-markdown' || scene === 'resize'
const events: Record<string, unknown>[] = []
const record = (kind: string, data: Record<string, unknown> = {}) => events.push({ kind, t: performance.now(), ...data })
const delay = monitorEventLoopDelay({ resolution: 10 })
delay.enable()
const metrics = createFrameMetrics()
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
let model: ViewModel = {
  history: Array.from({ length: scene === 'settings' ? 1 : count }, (_, id) => ({
    id, timestamp: Date.UTC(2026, 9, 21, 0, 0, id), kind: 'assistant' as const,
    text: scene === 'rich' || scene === 'live-markdown' ? `## Message ${id}\n\n复杂内容审查：中文 mixed prose and code.\n\n\`\`\`ts\nconst value = ${id};\nconsole.log(value);\n\`\`\`\n\n|字段|值|说明|\n|---|---|---|\n|key|${id}|中文配置与结构化输出|\n|status|ready|complete|`
      : `Row ${String(id).padStart(5, '0')} 中文滚动验证 · Provider settings.\nSecond line ${id}: stable terminal rendering.`,
  })),
  activeTurn: undefined, status: streaming ? 'generating' : 'idle', reasoningExpanded: scene === 'live-markdown', toolCardsExpanded: false,
}
const providers = Object.fromEntries(Array.from({ length: scene === 'settings' ? count : 0 }, (_, id) => [`provider-${id}-long-route-name`, {
  api: 'openai-completions', baseURL: `https://provider-${id}.example/v1`, apiKeyEnv: `PROVIDER_${id}_API_KEY`,
  defaultInput: ['text', 'image'], displayName: `Provider ${id}`, models: Array.from({ length: 65 }, (_, index) => ({ id: `model-${index}`, name: `Audit Model ${index}`, contextWindow: 32768, maxTokens: 8192, extension: { pricing: [0.1, 0.2] } })),
}]))
const descriptors = [
  { ns: 'tui', value: { theme: 'dark', locale: 'zh-CN', reasoning: false, scrollbar: true } },
  { ns: 'llm-pi-ai', value: { providers } },
  { ns: 'subagent', value: { maxActive: 8, maxDepth: 3 } },
  { ns: 'agent-loop', value: { maxSteps: 100, policy: { retries: 5, timeoutMs: 120000 } } },
]
const settingsNavigation = new SettingsNavigation(scene === 'settings' ? settingsTreeFromDescribe(descriptors as never, []) : [])
let settings: SettingsPaneState = { ...EMPTY_SETTINGS_PANE, open: scene === 'settings', rows: settingsNavigation.rows, breadcrumb: settingsNavigation.breadcrumb }
const syncSettings = () => {
  settings = { ...settings, rows: settingsNavigation.rows, selectedIndex: settingsNavigation.selectedIndex, breadcrumb: settingsNavigation.breadcrumb, filter: settingsNavigation.filter }
}
const emptySession = { rows: [], selectedIndex: 0, open: false, confirmDelete: false, deleteUnavailable: false, currentId: undefined }
const emptySearch = { query: '', results: [], selectedIndex: 0, open: false, status: 'idle' as const }
const emptyModel = { open: false, filter: '', rows: [], selectedIndex: 0, status: 'idle' as const }
const emptyHelp = { open: false, lines: [] }
const footer = { provider: 'offline', model: 'fixture', status: 'generating' }
const goal = { phase: 'active', activation: 'armed' as const, objective: '核对流式渲染边界', maxGoalRounds: 256, roundsStarted: 45 }
let composerHud: string | undefined
const controller: TuiController = {
  ...PASSIVE_CONTROLLER,
  getModel: () => model, getInteraction: () => model.status, getBadge: () => `offline ${count} ${scene}`, getTitle: () => 'TUI performance audit',
  getSessionPane: () => emptySession, getSearchPane: () => emptySearch, getTimelineOpen: () => false,
  getModelPane: () => emptyModel, getHelpPane: () => emptyHelp,
  getApprovalPane: () => EMPTY_APPROVAL_PANE, getAskUserPane: () => EMPTY_ASK_USER_PANE,
  getPermissionPane: () => EMPTY_PERMISSION_PANE, getSettingsPane: () => settings,
  getAgentHubPane: () => EMPTY_OVERLAY_PANE, getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
  getPlanReviewPane: () => EMPTY_OVERLAY_PANE, getComposerHud: () => composerHud,
  ...(scene === 'overlap' || scene === 'live-markdown' ? { getAdaptiveInfoFooter: () => footer, getGoalFooter: () => goal } : {}),
  getToolPresenters: () => undefined, getSubmitOnEnter: () => true, getFeedback: () => undefined,
  subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback) },
  commands: [], getCwd: () => '/offline-fixture', listMentions: async () => [],
  dispatch: action => {
    if (action.kind === 'settings-move') settingsNavigation.selectedIndex = Math.max(0, Math.min(settings.rows.length - 1, settingsNavigation.selectedIndex + action.delta))
    else if (action.kind === 'settings-group') settingsNavigation.group(action.delta)
    else if (action.kind === 'settings-search') { settingsNavigation.search(action.query); settings = { ...settings, searching: action.active } }
    else if (action.kind === 'settings-edit' || action.kind === 'settings-edit-json') {
      if (action.kind === 'settings-edit-json' || !settingsNavigation.enter()) settings = { ...settings, editing: true }
    } else if (action.kind === 'settings-escape') {
      if (!settingsNavigation.back()) settings = { ...settings, open: false }
    } else if (action.kind === 'settings-cancel-edit') settings = { ...settings, editing: false }
    else if (action.kind === 'settings-apply') {
      const row = settings.rows[settings.selectedIndex]
      const descriptor = descriptors.find(entry => entry.ns === row?.namespace)
      if (row !== undefined && descriptor !== undefined && row.sourcePath !== undefined) {
        try {
          const parsed = parseSettingsFieldValue(row.namespace, row.field, atPath(descriptor.value, row.sourcePath), action.value)
          const parent = atPath(descriptor.value, row.sourcePath.slice(0, -1)) as Record<string, unknown>
          parent[row.sourcePath.at(-1)!] = parsed
          settingsNavigation.replace(settingsTreeFromDescribe(descriptors as never, []))
          const { updateError: _error, ...rest } = settings
          settings = { ...rest, editing: false }
        } catch (error) { settings = { ...settings, editing: false, updateError: String(error) } }
      }
    }
    syncSettings()
    notify()
  },
}
// Record arrival before the production mouse parser; no hot-path disk writes.
process.stdin.on('data', chunk => record('input', { text: String(chunk), wheelReports: (String(chunk).match(/\x1b\[<6[45];/g) ?? []).length }))
const originalWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
  const text = typeof chunk === 'string' ? chunk : String(chunk)
  const frame = visibleFrameSnapshot()
  record('write', { bytes: Buffer.byteLength(text), sync: text.includes('\x1b[?2026l'), columns: process.stdout.columns, rows: process.stdout.rows,
    first: frame?.rows[0]?.id, last: frame?.rows.at(-1)?.id,
    signature: frame?.rows.map(row => `${row.row}:${row.id}`).join('|'), selected: settings.selectedIndex,
    ...((scene === 'live-markdown' || scene === 'overlap' || scene === 'resize') && text.includes('\x1b[?2026l') ? {
      expected: frame === undefined ? [] : Array.from({ length: frame.geometry.transcriptRows }, (_, index) => {
        const row = frame.geometry.transcriptTop + index
        return { row, col: frame.geometry.transcriptLeft, width: frame.geometry.transcriptWidth,
          text: frame.rows.find(line => line.row === row)?.line.text ?? '' }
      }), geometry: frame?.geometry,
    } : {}),
  })
  return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...args)
}) as typeof process.stdout.write
const defaults = renderPolicyDefaults()
// Counterfactual using the existing public render policy; production defaults are untouched.
const policy = variant === 'direct' ? { ...defaults, scroll: { ...defaults.scroll, stepPerFrame: 10000, maxCatchUpStep: 10000 } } : defaults
const dispose = mountTuiRender(createElement(Profiler, {
  id: 'audit', onRender: (_id, phase, actualDuration) => record('commit', { phase, actualDuration }),
  children: createElement(TuiLoop, { title: 'Audit', controller, frameMetrics: metrics, renderPolicy: policy }),
}), { frameMetrics: metrics, renderPolicy: policy, env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
let streamTimer: ReturnType<typeof setInterval> | undefined
if (streaming) {
  let text = 'live output\n'
  let tick = 0
  let turn = 1
  const markdown = `## LIVE_ 实测\n\n|方向组合|轮廓|渲染|\n|---|---|---|\n|左 +45° / 右 -45°|[-0.42,0.42]×[-0.33,0.33]|面片乱叠|\n|左 -45° / 右 +45°|同上（互为镜像）|面片乱叠|\n\n## 根本原因\n\n> 我用整片区域一个变换去映射，但同一区域里的面初始朝向不同，统一变换后必然互相穿插。\n\n正确做法：**逐面给出目标位置**（12 片 → 12 个映射）。\`op.collapse\` 本来就能表达任意逐面等距映射，缺的是映射表。\n\n下一步已写成具体任务：写一个辅助函数——给定当前 12 片质心和目标 12 个点，自动按最近点配对生成 12 个旋转平移。这样我只需要从图上量 12 个目标点。\n\n\`\`\`text\n26 models, 0 with problems\ngit 11addd7\nhttp://127.0.0.1:8899/index.html\n\`\`\`\n\nLIVE_ 下一轮继续工作，目标保持 active。\n`
  streamTimer = setInterval(() => {
    tick++
    if (scene === 'live-markdown') {
      const cursor = ((tick - 1) % Math.ceil(markdown.length / 8) + 1) * 8
      text = markdown.slice(0, cursor)
      const reasoning = 'LIVE_REASONING 正在分析逐面变换和目标映射表，随后输出完整结果。'
      if (cursor >= markdown.length) {
        model = { ...model, history: [...model.history, { id: 100000+turn, kind: 'assistant', text, reasoningText: reasoning, timestamp: Date.now(), turnOrdinal: turn }], activeTurn: undefined }
        turn++
      } else model = { ...model, activeTurn: { turn, assistantText: text, reasoningText: reasoning, reasoningDurationMs: tick*20, toolCalls: [], content: [{ kind: 'reasoning', text: reasoning, durationMs: tick*20 }, { kind: 'text', text }] } }
      notify()
      return
    }
    text += scene === 'overlap'
      ? `LIVE_${turn}_${tick} 中文与 **加粗** mixed data，表格输出及已提交文本不得穿入输入区。\n\n`
      : '流式新增一段输出，验证滚动和后台更新同时发生。\n'
    if (scene === 'overlap') composerHud = tick % 8 < 4 ? '后台任务正在执行' : undefined
    if (scene === 'overlap' && tick % 30 === 0) {
      model = { ...model, history: [...model.history, { id: 100000+turn, kind: 'assistant', text, timestamp: Date.now(), turnOrdinal: turn }], activeTurn: undefined }
      turn++
      text = ''
    } else model = { ...model, activeTurn: { turn, assistantText: text, reasoningText: '', reasoningDurationMs: 0, toolCalls: [], content: [{ kind: 'text', text }] } }
    notify()
  }, scene === 'live-markdown' ? 20 : 50)
}
let snapshots = 0
const save = () => writeFileSync(statsPath, JSON.stringify({ scene, count, variant, snapshots: ++snapshots,
  clockOffsetMs: Number(process.hrtime.bigint()) / 1e6 - performance.now(),
  events, frameMetrics: metrics.snapshot(), memory: process.memoryUsage(), cpu: process.cpuUsage(),
  eventLoop: { meanMs: delay.mean / 1e6, maxMs: delay.max / 1e6, p95Ms: delay.percentile(95) / 1e6 },
  settings: { rowCount: settings.rows.length, selected: settings.selectedIndex, breadcrumb: settings.breadcrumb,
    fields: settings.rows.map(row => ({ label: row.label, field: row.field, value: row.value })), editing: settings.editing },
}))
process.on('SIGUSR2', save)
process.once('SIGTERM', () => { if (streamTimer) clearInterval(streamTimer); save(); dispose(); process.exit(0) })
writeFileSync(`${statsPath}.ready`, 'ready\n')
