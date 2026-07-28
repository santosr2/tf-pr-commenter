export interface Counts {
  add: number
  change: number
  destroy: number
  replace: number
}

export type Status = 'changes' | 'no-changes' | 'failed'

export interface StackPlan {
  name: string
  path: string
  counts: Counts | null
  actionsText: string | null
  status: Status
}

export interface StackPlanView extends StackPlan {
  countsLine: string | null
  planCell: string
  total: number
  statusIcon: string
}

export interface RenderModel {
  header: string
  marker: string
  stacks: StackPlanView[]
  details: StackPlanView[]
  omittedCount: number
  totals: Counts
  statusIcon: Record<Status, string>
}

export const STATUS_ICON: Record<Status, string> = {
  changes: '✅',
  'no-changes': '⚪',
  failed: '❌'
}

export function countsLine(counts: Counts): string {
  return `+${counts.add} ~${counts.change} -${counts.destroy}`
}

export function countsTotal(counts: Counts): number {
  return counts.add + counts.change + counts.destroy
}

export function zeroCounts(): Counts {
  return { add: 0, change: 0, destroy: 0, replace: 0 }
}
