import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  loadStacksFromArtifactRoot,
  stackFromArtifact
} from '../src/core/artifact.js'
import { DEFAULT_TEMPLATE } from '../src/core/default-template.generated.js'
import { countsLine, type StackPlan } from '../src/core/model.js'
import { render } from '../src/core/render.js'
import { summarize, summarizeDrift } from '../src/core/summarize.js'
import { trimDiff } from '../src/core/trim.js'

const fixture = (name: string): string => join(import.meta.dirname, 'fixtures', name)

describe('core terraform plan rendering', () => {
  it('keeps the generated default template in sync with templates/default.eta', async () => {
    expect(DEFAULT_TEMPLATE).toBe(
      await readFile(
        join(import.meta.dirname, '..', 'templates', 'default.eta'),
        'utf8'
      )
    )
  })

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
        drift: [],
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
        drift: [],
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

  it('scans an artifact root, surfacing failed stacks that have no tfplan.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tf-pr-commenter-'))
    const fs = await import('node:fs/promises')

    const changed = join(root, 'plan-prod-api')
    await fs.mkdir(changed, { recursive: true })
    await writeFile(
      join(changed, 'plan-meta.json'),
      JSON.stringify({ path: 'prod/api', status: 'changes' })
    )
    await writeFile(
      join(changed, 'tfplan.json'),
      await readFile(fixture('tfplan-sample.json'), 'utf8')
    )

    // A failed stack carries only plan-meta.json — the plan-files glob would miss it.
    const failed = join(root, 'plan-prod-db')
    await fs.mkdir(failed, { recursive: true })
    await writeFile(
      join(failed, 'plan-meta.json'),
      JSON.stringify({ path: 'prod/db', status: 'failure' })
    )

    const stacks = await loadStacksFromArtifactRoot(root)

    expect(stacks.map((s) => s.path).sort()).toEqual(['prod/api', 'prod/db'])
    const failedStack = stacks.find((s) => s.path === 'prod/db')
    expect(failedStack?.status).toBe('failed')
    expect(failedStack?.counts).toBeNull()
  })

  it('scans a flat root when download-artifact extracts a lone artifact without a subdir', async () => {
    // A single-stack PR yields one artifact; download-artifact drops it flat into
    // the root instead of a plan-*/ subdir. The root itself is the stack dir.
    const root = await mkdtemp(join(tmpdir(), 'tf-pr-commenter-'))
    await writeFile(
      join(root, 'plan-meta.json'),
      JSON.stringify({ path: 'shared/common/databases/internal_tools', status: 'changes' })
    )
    await writeFile(
      join(root, 'tfplan.json'),
      await readFile(fixture('tfplan-sample.json'), 'utf8')
    )
    await writeFile(
      join(root, 'plan-clean.txt'),
      await readFile(fixture('plan-actions-sample.txt'), 'utf8')
    )

    const stacks = await loadStacksFromArtifactRoot(root)

    expect(stacks).toHaveLength(1)
    expect(stacks[0]?.path).toBe('shared/common/databases/internal_tools')
    expect(stacks[0]?.status).toBe('changes')
    expect(stacks[0]?.counts).toEqual({ add: 2, change: 1, destroy: 2, replace: 1 })
  })

  it('returns no stacks when the artifact root does not exist', async () => {
    expect(await loadStacksFromArtifactRoot(join(tmpdir(), 'tf-pr-commenter-missing-xyz'))).toEqual([])
  })

  it('summarizes resource_drift, labelling replacements and dropping no-op refreshes', async () => {
    const planJson = JSON.parse(await readFile(fixture('tfplan-drift-sample.json'), 'utf8'))

    expect(summarizeDrift(planJson)).toEqual([
      { address: 'module.security_group.aws_security_group.this[0]', action: 'update' },
      { address: 'module.db.aws_db_instance.this[0]', action: 'replace' }
    ])
  })

  it('renders a drift badge and a "Changed outside Terraform" block', () => {
    const body = render([
      {
        name: 'prod-api',
        path: 'prod/api',
        counts: { add: 0, change: 1, destroy: 0, replace: 0 },
        actionsText: '!   resource "aws_db_instance" "this" {',
        drift: [{ address: 'module.sg.aws_security_group.this[0]', action: 'update' }],
        status: 'changes'
      }
    ])

    expect(body).toContain('| `prod-api` | `+0 ~1 -0` | ✅ ⚠️ 1 drifted |')
    expect(body).toContain('**⚠️ Changed outside Terraform:**')
    expect(body).toContain('! module.sg.aws_security_group.this[0] (update)')
  })

  it('surfaces a drift-only stack that has no planned actions', () => {
    const body = render([
      {
        name: 'prod-db',
        path: 'prod/db',
        counts: { add: 0, change: 0, destroy: 0, replace: 0 },
        actionsText: null,
        drift: [{ address: 'module.db.aws_db_instance.this[0]', action: 'replace' }],
        status: 'changes'
      }
    ])

    // +0 ~0 -0 with no diff, but the drift is still visible in the table and a detail block.
    expect(body).toContain('⚠️ 1 drifted')
    expect(body).toContain('<details>')
    expect(body).toContain('! module.db.aws_db_instance.this[0] (replace)')
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
    drift: [],
    status: 'changes'
  }))
}
