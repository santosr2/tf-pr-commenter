export interface Counts {
  add: number
  change: number
  destroy: number
  replace: number
}

// A resource changed outside Terraform, from the plan JSON's resource_drift array.
export interface DriftItem {
  address: string
  action: string
}

export type Status = 'changes' | 'no-changes' | 'failed'

export interface StackPlan {
  name: string
  path: string
  counts: Counts | null
  actionsText: string | null
  drift: DriftItem[]
  status: Status
}

export interface StackPlanView extends StackPlan {
  countsLine: string | null
  planCell: string
  total: number
  statusIcon: string
  driftCount: number
  driftText: string | null
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

const DRIFT_MARKER: Record<string, string> = {
  update: '!',
  delete: '-',
  create: '+',
  replace: '!'
}

// A diff-flavoured block listing each object that changed outside Terraform, so it
// renders in the same ```diff fence as the plan actions.
export function driftText(drift: DriftItem[]): string | null {
  if (drift.length === 0) {
    return null
  }

  return drift
    .map((item) => `${DRIFT_MARKER[item.action] ?? '!'} ${item.address} (${item.action})`)
    .join('\n')
}
