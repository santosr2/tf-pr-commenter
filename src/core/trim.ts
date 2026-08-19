export type Tool = 'auto' | 'terraform' | 'terragrunt'

// `terragrunt run --all` interposes the unit it is streaming from between the log
// level and the `terraform:` marker:
//   00:00:49.042 STDOUT terraform: Plan: 1 to add, ...
//   18:24:41.775 STDOUT [common/databases/internal_tools] terraform: Plan: 1 to add, ...
// Without the optional label this matches nothing in run --all output, so every line
// keeps its prefix, no change marker sits at column 0, and drift counts zero.
const TERRAGRUNT_TERRAFORM_LINE =
  /^\d\S*\s+\w+\s+(?:\[(?<unit>[^\]]+)\]\s+)?terraform:\s?(?<body>.*)$/u
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
  const sections = collectSections(
    toToolLines(planText, tool),
    (text) => text.includes(ACTIONS_HEADER),
    (text) => text.trimStart().startsWith('Plan:')
  )

  return joinSections(sections)
}

// Terraform's "Objects have changed outside of Terraform" section is the schema-filtered
// view of drift — it already drops churn on computed and ignore_changes'd attributes that
// the plan JSON's resource_drift array still carries. Sourcing drift from this text keeps
// the comment aligned with what the plan output actually shows a reviewer.
export function trimDrift(planText: string, tool: Tool = 'auto'): string {
  const sections = collectSections(
    toToolLines(planText, tool),
    (text) => text.includes(DRIFT_HEADER),
    (text) => DRIFT_END.some((marker) => text.includes(marker))
  )

  // Skip the two-line intro so each body starts at its first "# <addr> has changed".
  return joinSections(
    sections.map((section) => {
      const introEnd = section.lines.findIndex((line) =>
        line.includes(DRIFT_INTRO_END)
      )

      return {
        unit: section.unit,
        lines: introEnd === -1 ? section.lines : section.lines.slice(introEnd + 1)
      }
    })
  )
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
  const sections = collectSections(
    toToolLines(planText, tool),
    (text) => text.includes(OUTPUTS_HEADER),
    (text) => OUTPUTS_END.some((marker) => text.includes(marker))
  )

  return joinSections(sections)
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

// A plan line paired with the run --all unit that emitted it, or null for output that
// carries no unit label (raw terraform, or single-unit terragrunt).
interface ToolLine {
  unit: string | null
  text: string
}

interface Section {
  unit: string | null
  lines: string[]
}

function toToolLines(planText: string, tool: Tool): ToolLine[] {
  return planText.split(/\r?\n/u).map((line) => {
    if (tool === 'terraform') {
      return { unit: null, text: line }
    }

    const groups = TERRAGRUNT_TERRAFORM_LINE.exec(line)?.groups
    if (groups) {
      return { unit: groups.unit ?? null, text: groups.body ?? '' }
    }

    return { unit: null, text: line }
  })
}

// An account-level `run --all` writes one section per unit into a single stream, so
// taking the first match would report whichever unit finished first and silently drop
// the rest. Collect every section instead, keyed by the unit that opened it.
function collectSections(
  lines: ToolLine[],
  isHeader: (text: string) => boolean,
  isEnd: (text: string) => boolean
): Section[] {
  const sections: Section[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]
    if (!header || !isHeader(header.text)) {
      continue
    }

    const body: string[] = []
    let cursor = index + 1

    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (!line) {
        continue
      }

      // Terragrunt emits each unit's plan block atomically, but sibling units still
      // stream into the gaps between blocks. A line from another unit belongs to a
      // different section, so it must neither terminate this one nor join its body.
      if (line.unit !== header.unit) {
        continue
      }

      if (isEnd(line.text)) {
        break
      }

      body.push(line.text)
    }

    sections.push({ unit: header.unit, lines: body })
    index = cursor
  }

  return sections
}

// Label each body with its unit so a reviewer can tell which unit a block came from.
// Unlabelled output (single stack) renders exactly as it did before.
function joinSections(sections: Section[]): string {
  const rendered: string[] = []

  for (const section of sections) {
    const body = section.lines
      .map((line) => shiftChangeMarker(line))
      .join('\n')
      .replace(/^\n+|\n+$/gu, '')

    if (!body) {
      continue
    }

    rendered.push(section.unit === null ? body : `# ${section.unit}\n${body}`)
  }

  return rendered.join('\n\n')
}

function shiftChangeMarker(line: string): string {
  return line.replace(
    CHANGE_MARKER,
    (_match: string, indent: string, symbol: string) =>
      `${MARKER_MAP[symbol] ?? symbol} ${indent}`
  )
}
