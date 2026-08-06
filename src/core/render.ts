import {
  STATUS_ICON,
  countsLine,
  countsTotal,
  driftText,
  type Counts,
  type RenderModel,
  type StackPlan,
  type StackPlanView,
  zeroCounts
} from './model.js'
import {
  DEFAULT_TEMPLATE,
  compileTemplate,
  renderTemplate
} from './template.js'

export interface RenderOptions {
  budget?: number
  header?: string
  marker?: string
  template?: string
}

const DEFAULT_BUDGET = 65000
const DEFAULT_HEADER = '🏗️ Terraform Plan'
const DEFAULT_MARKER = '<!-- tf-pr-commenter -->'

export function render(stacks: StackPlan[], options: RenderOptions = {}): string {
  const budget = options.budget ?? DEFAULT_BUDGET
  const marker = options.marker ?? DEFAULT_MARKER
  const templateParts = compileTemplate(options.template ?? DEFAULT_TEMPLATE)
  const stackViews = stacks.map(toStackView)
  // A drift-only stack (objects changed outside Terraform, no planned action) has no
  // actionsText but still warrants a detail block, so include it as a candidate and
  // weight the budget ordering by drift too.
  const candidates = [...stackViews]
    .filter((stack) => stack.actionsText || stack.driftText)
    .sort((a, b) => b.total + b.driftCount - (a.total + a.driftCount))

  const included: StackPlanView[] = []
  const detailSections: string[] = []
  const limit = Math.floor(budget * 0.9)

  for (const candidate of candidates) {
    const candidateSection = renderDetailSection(templateParts.detail, candidate)
    const candidateIncluded = [...included, candidate]
    const candidateSections = [...detailSections, candidateSection]
    const omittedCount = candidates.length - candidateIncluded.length
    const candidateBody = renderFullBody(marker, templateParts.shell, {
      header: options.header ?? DEFAULT_HEADER,
      marker,
      stacks: stackViews,
      details: candidateIncluded,
      omittedCount,
      totals: sumCounts(stackViews),
      statusIcon: STATUS_ICON
    }, candidateSections)

    if (candidateBody.length <= limit) {
      included.push(candidate)
      detailSections.push(candidateSection)
    }
  }

  const omittedCount = candidates.length - included.length
  return renderFullBody(
    marker,
    templateParts.shell,
    {
      header: options.header ?? DEFAULT_HEADER,
      marker,
      stacks: stackViews,
      details: included,
      omittedCount,
      totals: sumCounts(stackViews),
      statusIcon: STATUS_ICON
    },
    detailSections
  )
}

function renderFullBody(
  marker: string,
  shellTemplate: string,
  model: RenderModel,
  detailSections: string[]
): string {
  const body = renderTemplate(shellTemplate, {
    ...model,
    detailSections
  }).trim()

  return `${marker}\n\n${body}`
}

function renderDetailSection(
  detailTemplate: string,
  stack: StackPlanView
): string {
  return renderTemplate(detailTemplate, {
    stack,
    statusIcon: STATUS_ICON
  }).trim()
}

function toStackView(stack: StackPlan): StackPlanView {
  const line = stack.counts ? countsLine(stack.counts) : null
  return {
    ...stack,
    countsLine: line,
    planCell: line ? `\`${line}\`` : '—',
    total: stack.counts ? countsTotal(stack.counts) : 0,
    statusIcon: STATUS_ICON[stack.status],
    driftCount: stack.drift.length,
    driftText: driftText(stack.drift)
  }
}

function sumCounts(stacks: StackPlanView[]): Counts {
  const totals = zeroCounts()
  for (const stack of stacks) {
    if (!stack.counts) {
      continue
    }

    totals.add += stack.counts.add
    totals.change += stack.counts.change
    totals.destroy += stack.counts.destroy
    totals.replace += stack.counts.replace
  }

  return totals
}
