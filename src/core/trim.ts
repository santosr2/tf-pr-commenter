export type Tool = 'auto' | 'terraform' | 'terragrunt'

const TERRAGRUNT_TERRAFORM_LINE = /^\d\S*\s+\w+\s+terraform:\s?(.*)$/
const CHANGE_MARKER = /^(\s*)(-\/\+|\+\/-|[+~-]) /
const ACTIONS_HEADER = 'will perform the following actions'
// Terraform's drift report. Its intro spans two lines ending in this phrase; the
// body of "# <addr> has changed" blocks follows, terminated by any of DRIFT_END.
const DRIFT_HEADER = 'Objects have changed outside of Terraform'
const DRIFT_INTRO_END = 'may have affected this plan'
const DRIFT_END = [
  'Unless you have made equivalent changes',
  ACTIONS_HEADER,
  'Terraform used the selected providers',
  '─'
]
// Terraform's "Changes to Outputs:" section. The body runs until any of these,
// which cover the trailing "apply to save output values" note, the saved-plan
// line, a warning box, or a horizontal rule.
const OUTPUTS_HEADER = 'Changes to Outputs:'
const OUTPUTS_END = [
  'You can apply this plan',
  'Saved the plan to',
  'Releasing state lock',
  'Warning:',
  'Note:',
  '─',
  '╵',
  '╷'
]
const MARKER_MAP: Record<string, string> = {
  '~': '!',
  '-/+': '!',
  '+/-': '!'
}

export function trimDiff(planText: string, tool: Tool = 'auto'): string {
  const lines = normalizeToolLines(planText, tool)
  const start = lines.findIndex((line) => line.includes(ACTIONS_HEADER))

  if (start === -1) {
    return ''
  }

  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trimStart().startsWith('Plan:')) {
      break
    }

    body.push(shiftChangeMarker(line))
  }

  return body.join('\n').replace(/^\n+|\n+$/gu, '')
}

// Terraform's "Objects have changed outside of Terraform" section is the schema-filtered
// view of drift — it already drops churn on computed and ignore_changes'd attributes that
// the plan JSON's resource_drift array still carries. Sourcing drift from this text keeps
// the comment aligned with what the plan output actually shows a reviewer.
export function trimDrift(planText: string, tool: Tool = 'auto'): string {
  const lines = normalizeToolLines(planText, tool)
  const headerIndex = lines.findIndex((line) => line.includes(DRIFT_HEADER))

  if (headerIndex === -1) {
    return ''
  }

  // Skip the two-line intro so the body starts at the first "# <addr> has changed".
  const introOffset = lines
    .slice(headerIndex)
    .findIndex((line) => line.includes(DRIFT_INTRO_END))
  const start = introOffset === -1 ? headerIndex : headerIndex + introOffset

  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (DRIFT_END.some((marker) => line.includes(marker))) {
      break
    }

    body.push(shiftChangeMarker(line))
  }

  return body.join('\n').replace(/^\n+|\n+$/gu, '')
}

// Count of drifted resources, one per "# <addr> has changed" header in the drift text.
export function countDrift(driftText: string | null): number {
  if (!driftText) {
    return 0
  }

  return (driftText.match(/^\s*# .* has changed$/gmu) ?? []).length
}

// Output changes are the lowest-signal channel (often just "(sensitive value)" and no
// real infrastructure change), so they are opt-in. This extracts the "Changes to Outputs:"
// section, mirroring trimDrift.
export function trimOutputs(planText: string, tool: Tool = 'auto'): string {
  const lines = normalizeToolLines(planText, tool)
  const headerIndex = lines.findIndex((line) => line.includes(OUTPUTS_HEADER))

  if (headerIndex === -1) {
    return ''
  }

  const body: string[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (OUTPUTS_END.some((marker) => line.includes(marker))) {
      break
    }

    body.push(shiftChangeMarker(line))
  }

  return body.join('\n').replace(/^\n+|\n+$/gu, '')
}

// Count of changed top-level outputs. Terraform indents each with two spaces, so after
// marker-shifting a top-level entry reads "<marker> <2-space indent><name>" — marker then
// exactly three spaces then a non-space. Nested lines of a complex output sit deeper and
// are excluded.
export function countOutputs(outputsText: string | null): number {
  if (!outputsText) {
    return 0
  }

  return (outputsText.match(/^[+!-] {3}\S/gmu) ?? []).length
}

function normalizeToolLines(planText: string, tool: Tool): string[] {
  return planText.split(/\r?\n/u).map((line) => {
    if (tool === 'terraform') {
      return line
    }

    const match = TERRAGRUNT_TERRAFORM_LINE.exec(line)
    if (match) {
      return match[1] ?? ''
    }

    return line
  })
}

function shiftChangeMarker(line: string): string {
  return line.replace(
    CHANGE_MARKER,
    (_match: string, indent: string, symbol: string) =>
      `${MARKER_MAP[symbol] ?? symbol} ${indent}`
  )
}
