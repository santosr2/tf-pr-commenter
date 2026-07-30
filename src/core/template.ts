import { Eta } from 'eta'

import { DEFAULT_TEMPLATE } from './default-template.generated.js'

export { DEFAULT_TEMPLATE } from './default-template.generated.js'

export interface TemplateParts {
  shell: string
  detail: string
}

export interface DetailTemplateContext {
  stack: unknown
  statusIcon: Record<string, string>
}

export interface ShellTemplateContext {
  detailSections: string[]
  [key: string]: unknown
}

export const DETAIL_MARKER = '<!-- tf-pr-commenter:detail -->'
export const SHELL_MARKER = '<!-- tf-pr-commenter:shell -->'

const DEFAULT_TEMPLATE_PARTS = parseDefaultTemplate()

export const DEFAULT_DETAIL_TEMPLATE = DEFAULT_TEMPLATE_PARTS.detail
export const DEFAULT_SHELL_TEMPLATE = DEFAULT_TEMPLATE_PARTS.shell

const eta = new Eta({ autoEscape: false })

export function compileTemplate(source = DEFAULT_TEMPLATE): TemplateParts {
  const markedParts = parseMarkedTemplate(source)
  if (markedParts) {
    return markedParts
  }

  const shellIndex = source.indexOf(SHELL_MARKER)
  if (shellIndex !== -1) {
    return {
      detail: DEFAULT_DETAIL_TEMPLATE,
      shell: source.slice(shellIndex + SHELL_MARKER.length).trim()
    }
  }

  return {
    detail: DEFAULT_DETAIL_TEMPLATE,
    shell: source.trim()
  }
}

export function renderTemplate(
  template: string,
  data: object
): string {
  return eta.renderString(template, data)
}

function parseDefaultTemplate(): TemplateParts {
  const parts = parseMarkedTemplate(DEFAULT_TEMPLATE)
  if (!parts) {
    throw new Error('templates/default.eta must define detail and shell sections')
  }

  return parts
}

function parseMarkedTemplate(source: string): TemplateParts | null {
  const detailIndex = source.indexOf(DETAIL_MARKER)
  const shellIndex = source.indexOf(SHELL_MARKER)

  if (detailIndex !== -1 && shellIndex !== -1 && detailIndex < shellIndex) {
    return {
      detail: source
        .slice(detailIndex + DETAIL_MARKER.length, shellIndex)
        .trim(),
      shell: source.slice(shellIndex + SHELL_MARKER.length).trim()
    }
  }

  return null
}
