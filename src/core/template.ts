import { Eta } from 'eta'

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

export const DEFAULT_DETAIL_TEMPLATE = `<details><summary>📋 <code><%= it.stack.name %></code><% if (it.stack.countsLine) { %> <code><%= it.stack.countsLine %></code><% } %></summary>

\`\`\`diff
<%~ it.stack.actionsText + '\\n' %>
\`\`\`

</details>`

export const DEFAULT_SHELL_TEMPLATE = `<% if (it.stacks.length === 0) { %>
## <%= it.header %>

✅ No stacks with changes to plan.
<% } else { %>
## <%= it.header %> — <%= it.stacks.length %> stack<%= it.stacks.length === 1 ? '' : 's' %>

| Stack | Plan | Status |
|---|---|---|
<% it.stacks.forEach((stack) => { %>| \`<%= stack.name %>\` | <%~ stack.planCell %> | <%= stack.statusIcon %> |
<% }) %><% if (it.detailSections.length) { %>

<%~ it.detailSections.join('\\n\\n') %>
<% } %><% if (it.omittedCount > 0) { %>

> ⚠️ Plan detail for <%= it.omittedCount %> stack<%= it.omittedCount === 1 ? '' : 's' %> omitted to fit the comment size limit — see each job's step summary. Counts above are complete.
<% } %><% } %>`

export const DEFAULT_TEMPLATE = `${DETAIL_MARKER}
${DEFAULT_DETAIL_TEMPLATE}
${SHELL_MARKER}
${DEFAULT_SHELL_TEMPLATE}`

const eta = new Eta({ autoEscape: false })

export function compileTemplate(source = DEFAULT_TEMPLATE): TemplateParts {
  const detailIndex = source.indexOf(DETAIL_MARKER)
  const shellIndex = source.indexOf(SHELL_MARKER)

  if (detailIndex !== -1 && shellIndex !== -1) {
    if (detailIndex > shellIndex) {
      throw new Error(`${DETAIL_MARKER} must appear before ${SHELL_MARKER}`)
    }

    return {
      detail: source
        .slice(detailIndex + DETAIL_MARKER.length, shellIndex)
        .trim(),
      shell: source.slice(shellIndex + SHELL_MARKER.length).trim()
    }
  }

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
