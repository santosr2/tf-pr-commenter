import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import * as core from '@actions/core'
import * as github from '@actions/github'

import {
  expandInputFiles,
  loadStacksFromArtifactRoot,
  stackFromFiles
} from '../core/artifact.js'
import type { StackPlan } from '../core/model.js'
import { render } from '../core/render.js'
import type { Tool } from '../core/trim.js'
import { upsertComment } from '../github/comment.js'
import {
  failedJobsBanner,
  failedOrCancelledNames,
  jobUrlsByStack,
  listRunJobs
} from '../github/jobs.js'

export async function run(): Promise<void> {
  try {
    const cwd = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const tool = parseTool(core.getInput('tool') || 'auto')
    // Two discovery modes:
    //   plan-root  — scan an artifact dir of plan-*/ subdirs. Surfaces FAILED stacks
    //                (only plan-meta.json, no tfplan.json) that the plan-files glob misses.
    //   plan-files — glob tfplan.json files directly (one stack per file).
    const planRoot = core.getInput('plan-root')
    const stacks = planRoot
      ? await loadStacksFromArtifactRoot(resolve(cwd, planRoot), tool)
      : await loadStacksFromPlanFiles(cwd, tool)
    const template = await readTemplateInput(core.getInput('template'), cwd)
    const marker = core.getInput('marker') || '<!-- tf-pr-commenter -->'
    const pullRequestNumber = github.context.payload.pull_request?.number
    if (!pullRequestNumber) {
      throw new Error('tf-pr-commenter must run in a pull_request context')
    }

    const token = core.getInput('github-token', { required: true })
    const octokit = github.getOctokit(token)

    // Both the failed-jobs banner and the per-stack job links read this run's jobs, so
    // fetch them once. Needs `actions: read`; listRunJobs degrades to [] without it.
    const warnOnFailedJobs = core.getBooleanInput('warn-on-failed-jobs')
    const jobLinkPattern = parseJobLinkPattern(core.getInput('job-link-pattern'))
    const jobs =
      warnOnFailedJobs || jobLinkPattern
        ? await listRunJobs({
            octokit,
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            runId: github.context.runId
          })
        : []

    const renderOptions = {
      budget: parseBudget(core.getInput('char-budget')),
      header: core.getInput('header') || '🏗️ Terraform Plan',
      marker,
      showOutputs: core.getBooleanInput('show-outputs'),
      showUnchanged: core.getBooleanInput('show-unchanged'),
      ...(jobLinkPattern
        ? {
            jobUrls: jobUrlsByStack(
              jobs,
              stacks.map((stack) => stack.path),
              jobLinkPattern
            )
          }
        : {}),
      ...(template ? { template } : {})
    }
    let body = render(stacks, renderOptions)

    // A comment rendered from artifacts alone can't tell "no changes" apart from "a job
    // failed/cancelled and emitted nothing". If any job failed or was cancelled, prepend a
    // banner so the comment never reads as success while a job actually failed.
    if (warnOnFailedJobs) {
      const banner = failedJobsBanner(failedOrCancelledNames(jobs))
      if (banner) {
        body = insertAfterMarker(body, marker, banner)
      }
    }

    const comment = await upsertComment({
      octokit,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issueNumber: pullRequestNumber,
      marker,
      body
    })

    core.setOutput('comment-id', String(comment.id))
    core.setOutput('body', body)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

async function loadStacksFromPlanFiles(
  cwd: string,
  tool: Tool
): Promise<StackPlan[]> {
  const planFiles = await expandInputFiles(core.getInput('plan-files'), cwd)
  const planTextInput = core.getInput('plan-text-files')
  const planTextFiles = planTextInput
    ? await expandInputFiles(planTextInput, cwd)
    : []
  const planTextByDirectory = new Map(
    planTextFiles.map((file) => [dirname(file), file])
  )

  return Promise.all(
    planFiles.map((planFile) => {
      const planTextFile = planTextByDirectory.get(dirname(planFile))
      return stackFromFiles({
        planFile,
        metaFile: join(dirname(planFile), 'plan-meta.json'),
        cwd,
        tool,
        ...(planTextFile ? { planTextFile } : {})
      })
    })
  )
}

function parseBudget(input: string): number {
  const budget = Number.parseInt(input, 10)
  if (!Number.isFinite(budget) || budget <= 0) {
    return 65000
  }

  return budget
}

// upsertComment locates the comment via body.startsWith(marker), so the marker must stay
// first. Insert the banner immediately after it.
function insertAfterMarker(
  body: string,
  marker: string,
  insertion: string
): string {
  if (!body.startsWith(marker)) {
    return `${marker}\n\n${insertion}\n\n${body}`
  }

  return `${marker}\n\n${insertion}${body.slice(marker.length)}`
}

// Empty input turns per-stack job links off. An invalid pattern is a config error worth
// failing on rather than silently rendering an unlinked table.
function parseJobLinkPattern(input: string): RegExp | null {
  if (!input.trim()) {
    return null
  }

  try {
    return new RegExp(input, 'iu')
  } catch {
    throw new Error(`invalid job-link-pattern: ${input}`)
  }
}

function parseTool(input: string): Tool {
  if (input === 'terraform' || input === 'terragrunt' || input === 'auto') {
    return input
  }

  throw new Error(`invalid tool input: ${input}`)
}

async function readTemplateInput(
  input: string,
  cwd: string
): Promise<string | undefined> {
  if (!input.trim()) {
    return undefined
  }

  const possiblePath = resolve(cwd, input)
  try {
    return await readFile(possiblePath, 'utf8')
  } catch {
    return input
  }
}
