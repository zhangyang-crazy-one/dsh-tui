/** Width-matrix inputs for mixed prose, compact status, and oversized identifiers. */
import { PRESET_TABLE_CELLS } from './preset-table.ts'

/** Tables exercise the shared allocator without terminal- or provider-specific values. */
export const TABLE_BENCHMARK_CASES = {
  presets: PRESET_TABLE_CELLS,
  status: [
    ['任务', '✓', '说明'],
    ['任务一', '✅', '读取输入后完成验证，结果已经保存。'],
    ['task two', '⏳', 'Waiting for the next input with no retry scheduled.'],
    ['任务三', '❌', '失败原因明确保留，用户可以打开详情。'],
  ],
  identifiers: [
    ['id', 'description', '✓'],
    ['0123456789abcdef'.repeat(4), 'Mixed prose with complete identifiers and readable wrapping.', '✅'],
    ['short-id', '另一条记录包含多种信息，字段不应因单个长标识符变得狭窄。', '⏳'],
    ['other-id', 'Several words explaining the result without hiding the final sentence.', '❌'],
  ],
} as const
