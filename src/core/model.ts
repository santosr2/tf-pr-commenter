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
  // Terraform's rendered "Objects have changed outside of Terraform" block, or null.
  driftText: string | null
  // Terraform's rendered "Changes to Outputs:" block, or null. Only surfaced when the
  // show-outputs option is on, since output-only diffs are the lowest-signal channel.
  outputsText: string | null
  status: Status
}

export interface StackPlanView extends StackPlan {
  countsLine: string | null
  // The stack name as a table cell: a link to the job that planned it when one was
  // resolved, plain code otherwise.
  nameCell: string
  planCell: string
  total: number
  statusIcon: string
  driftCount: number
  outputsCount: number
}

export interface RenderModel {
  header: string
  marker: string
  stacks: StackPlanView[]
  details: StackPlanView[]
  omittedCount: number
  // Stacks kept out of `stacks` because they had nothing to report. Zero when
  // show-unchanged is on.
  unchangedCount: number
  // Every stack planned, including the ones hidden as unchanged.
  totalCount: number
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
