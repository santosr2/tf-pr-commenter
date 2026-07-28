export type Tool = 'auto' | 'terraform' | 'terragrunt'

const TERRAGRUNT_TERRAFORM_LINE = /^\d\S*\s+\w+\s+terraform:\s?(.*)$/
const CHANGE_MARKER = /^(\s*)(-\/\+|\+\/-|[+~-]) /
const ACTIONS_HEADER = 'will perform the following actions'
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
