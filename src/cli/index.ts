import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  expandInputFiles,
  loadStacksFromArtifactRoot,
  stackFromFiles
} from '../core/artifact.js'
import { render } from '../core/render.js'
import type { Tool } from '../core/trim.js'

export async function main(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv.slice(2))
  const stacks = args.planFiles
    ? await loadStacksFromPlanFiles(args.planFiles, args.planTextFiles, args.tool)
    : await loadStacksFromArtifactRoot(args.root ?? 'plan-artifacts', args.tool)
  const template = args.template ? await readTemplate(args.template) : undefined
  const renderOptions = {
    ...(args.budget ? { budget: args.budget } : {}),
    ...(args.header ? { header: args.header } : {}),
    ...(args.marker ? { marker: args.marker } : {}),
    ...(template ? { template } : {})
  }
  process.stdout.write(render(stacks, renderOptions))
  process.stdout.write('\n')
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main(process.argv)
  process.exitCode = exitCode
}

interface CliArgs {
  root?: string
  planFiles?: string
  planTextFiles?: string
  budget?: number
  header?: string
  marker?: string
  template?: string
  tool: Tool
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { tool: 'auto' }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    if (!arg) {
      continue
    }

    if (arg === '--plan-files' && next) {
      parsed.planFiles = next
      index += 1
    } else if (arg === '--plan-text-files' && next) {
      parsed.planTextFiles = next
      index += 1
    } else if (arg === '--budget' && next) {
      parsed.budget = Number.parseInt(next, 10)
      index += 1
    } else if (arg === '--header' && next) {
      parsed.header = next
      index += 1
    } else if (arg === '--marker' && next) {
      parsed.marker = next
      index += 1
    } else if (arg === '--template' && next) {
      parsed.template = next
      index += 1
    } else if (arg === '--tool' && next) {
      parsed.tool = parseTool(next)
      index += 1
    } else if (!arg?.startsWith('--')) {
      parsed.root = arg
    } else {
      throw new Error(`unknown or incomplete argument: ${arg ?? ''}`)
    }
  }

  return parsed
}

async function loadStacksFromPlanFiles(
  planFilesInput: string,
  planTextFilesInput: string | undefined,
  tool: Tool
): Promise<Awaited<ReturnType<typeof stackFromFiles>>[]> {
  const planFiles = await expandInputFiles(planFilesInput)
  const planTextFiles = planTextFilesInput
    ? await expandInputFiles(planTextFilesInput)
    : []
  const planTextByDirectory = new Map(
    planTextFiles.map((file) => [dirname(resolve(file)), file])
  )

  return Promise.all(
    planFiles.map((planFile) => {
      const planTextFile = planTextByDirectory.get(dirname(resolve(planFile)))
      return stackFromFiles({
        planFile,
        tool,
        ...(planTextFile ? { planTextFile } : {})
      })
    })
  )
}

async function readTemplate(input: string): Promise<string> {
  try {
    return await readFile(resolve(input), 'utf8')
  } catch {
    return input
  }
}

function parseTool(input: string): Tool {
  if (input === 'terraform' || input === 'terragrunt' || input === 'auto') {
    return input
  }

  throw new Error(`invalid tool: ${input}`)
}
