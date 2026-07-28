import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { stackFromArtifact } from '../src/core/artifact.js'
import { countsLine, type StackPlan } from '../src/core/model.js'
import { render } from '../src/core/render.js'
import { summarize } from '../src/core/summarize.js'
import { trimDiff } from '../src/core/trim.js'

const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name)

describe('core terraform plan rendering', () => {
  it('counts resource actions with replacements counted as add and destroy', async () => {
    const plan = JSON.parse(await readFile(fixture('tfplan-sample.json'), 'utf8'))

    const counts = summarize(plan)

    expect(counts).toEqual({ add: 2, change: 1, destroy: 2, replace: 1 })
    expect(countsLine(counts)).toBe('+2 ~1 -2')
  })

  it('trims terragrunt plan output to colorized column-0 diff actions', async () => {
    const planText = await readFile(fixture('plan-actions-sample.txt'), 'utf8')

    const diff = trimDiff(planText)

    expect(diff).not.toContain('Initializing the backend')
    expect(diff).not.toContain('Refreshing state')
    expect(diff).not.toContain('Reading...')
    expect(diff).not.toContain('Plan: 2 to add')
    expect(diff.startsWith('\n')).toBe(false)
    expect(diff).toMatch(/^\+ +resource "aws_s3_bucket" "logs" \{/m)
    expect(diff).toMatch(/^! +resource "aws_instance" "app" \{/m)
    expect(diff).toMatch(/^! +tags = \{/m)
    expect(diff).toMatch(/^- +"old" = "yes"/m)
    expect(diff).toMatch(/^\+ +"new" = "yes"/m)
    expect(diff).toMatch(/^! +resource "aws_lb" "main" \{/m)
    expect(diff).toMatch(/^- +resource "aws_iam_role" "old" \{/m)
    expect(diff).not.toMatch(/^[^\S\r\n]+[+!-] /m)
  })

  it('also trims raw terraform output without a terragrunt prefix', () => {
    const diff = trimDiff(`
Terraform will perform the following actions:

  ~ resource "aws_instance" "app" {
      ~ ami = "ami-old" -> "ami-new"
    }

Plan: 0 to add, 1 to change, 0 to destroy.
`)

    expect(diff).toMatch(/^! +resource "aws_instance" "app" \{/m)
    expect(diff).toMatch(/^! +ami = "ami-old" -> "ami-new"/m)
  })

  it('keeps every summary row while dropping oversized detail blocks whole', () => {
    const stacks = makeLargeStacks(8)

    const body = render(stacks, { budget: 1700, header: 'Terraform Plan' })

    for (const stack of stacks) {
      expect(body).toContain(`| \`${stack.name}\` |`)
    }
    expect(body).toContain('Plan detail for')
    expect(body).toContain('omitted to fit the comment size limit')
    expect(body).not.toMatch(/```diff\n[^`]*$/)
    expect(body.length).toBeLessThanOrEqual(1700)
  })

  it('renders failed stacks with no plan cell and no diff detail', () => {
    const body = render([
      {
        name: 'prod-failed',
        path: 'prod/failed',
        counts: null,
        actionsText: null,
        status: 'failed'
      }
    ])

    expect(body).toContain('| `prod-failed` | — | ❌ |')
    expect(body).not.toContain('<details>')
  })

  it('renders default diff fences on their own lines', async () => {
    const body = render([
      {
        name: 'prod-api',
        path: 'prod/api',
        counts: { add: 1, change: 0, destroy: 0, replace: 0 },
        actionsText: trimDiff(await readFile(fixture('plan-actions-sample.txt'), 'utf8')),
        status: 'changes'
      }
    ])

    expect(body).toContain('```diff\n+   resource')
    expect(body).toMatch(/ {4}\}\n```\n\n<\/details>/)
  })

  it('applies custom shell and detail templates without exceeding the budget', () => {
    const template = `
<!-- tf-pr-commenter:detail -->
<section data-stack="<%= it.stack.name %>"><%= it.stack.actionsText %></section>
<!-- tf-pr-commenter:shell -->
# <%= it.header %>
<% it.stacks.forEach((stack) => { %>
- <%= stack.name %>: <%= stack.countsLine ?? 'none' %>
<% }) %>
<%~ it.detailSections.join('\\n') %>
<% if (it.omittedCount) { %>
omitted=<%= it.omittedCount %>
<% } %>
`

    const body = render(makeLargeStacks(5), {
      budget: 900,
      header: 'Custom Plan',
      template
    })

    expect(body).toContain('# Custom Plan')
    expect(body).toContain('- stack-0: +5 ~0 -0')
    expect(body).toContain('omitted=')
    expect(body.length).toBeLessThanOrEqual(900)
  })

  it('loads a stack from a real artifact directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tf-pr-commenter-'))
    const artifact = join(root, 'plan-prod-api')
    await writeFile(join(root, '.keep'), '')
    await import('node:fs/promises').then((fs) =>
      fs.mkdir(artifact, { recursive: true })
    )
    await writeFile(
      join(artifact, 'plan-meta.json'),
      JSON.stringify({ path: 'prod/api', status: 'changes' })
    )
    await writeFile(
      join(artifact, 'tfplan.json'),
      await readFile(fixture('tfplan-sample.json'), 'utf8')
    )
    await writeFile(
      join(artifact, 'plan-clean.txt'),
      await readFile(fixture('plan-actions-sample.txt'), 'utf8')
    )

    const stack = await stackFromArtifact(artifact)

    expect(stack.name).toBe('prod/api')
    expect(stack.path).toBe('prod/api')
    expect(stack.counts).toEqual({ add: 2, change: 1, destroy: 2, replace: 1 })
    expect(stack.actionsText).toMatch(/^! +resource "aws_instance"/m)
    expect(stack.status).toBe('changes')
  })
})

function makeLargeStacks(count: number): StackPlan[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `stack-${index}`,
    path: `env/stack-${index}`,
    counts: { add: 5 - Math.min(index, 4), change: index % 2, destroy: index % 3, replace: 0 },
    actionsText: [
      `+   resource "aws_s3_bucket" "stack_${index}" {`,
      ...Array.from({ length: 12 }, (__, line) => `+     attr_${line} = "${'x'.repeat(24)}"`),
      '+   }'
    ].join('\n'),
    status: 'changes'
  }))
}
