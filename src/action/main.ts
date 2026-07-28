import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import * as core from '@actions/core'
import * as github from '@actions/github'

import {
  expandInputFiles,
  stackFromFiles
} from '../core/artifact.js'
import { render } from '../core/render.js'
import type { Tool } from '../core/trim.js'
import { upsertComment } from '../github/comment.js'

export async function run(): Promise<void> {
  try {
    const cwd = process.env.GITHUB_WORKSPACE ?? process.cwd()
    const planFiles = await expandInputFiles(core.getInput('plan-files'), cwd)
    const planTextInput = core.getInput('plan-text-files')
    const planTextFiles = planTextInput
      ? await expandInputFiles(planTextInput, cwd)
      : []
    const planTextByDirectory = new Map(
      planTextFiles.map((file) => [dirname(file), file])
    )
    const tool = parseTool(core.getInput('tool') || 'auto')
    const stacks = await Promise.all(
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
    const template = await readTemplateInput(core.getInput('template'), cwd)
    const marker = core.getInput('marker') || '<!-- tf-pr-commenter -->'
    const renderOptions = {
      budget: parseBudget(core.getInput('char-budget')),
      header: core.getInput('header') || '🏗️ Terraform Plan',
      marker,
      ...(template ? { template } : {})
    }
    const body = render(stacks, renderOptions)
    const pullRequestNumber = github.context.payload.pull_request?.number
    if (!pullRequestNumber) {
      throw new Error('tf-pr-commenter must run in a pull_request context')
    }

    const token = core.getInput('github-token', { required: true })
    const octokit = github.getOctokit(token)
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

function parseBudget(input: string): number {
  const budget = Number.parseInt(input, 10)
  if (!Number.isFinite(budget) || budget <= 0) {
    return 65000
  }

  return budget
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
