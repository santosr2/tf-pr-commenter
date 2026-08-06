import { access, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import fg from 'fast-glob'

import type { StackPlan } from './model.js'
import { summarize, summarizeDrift } from './summarize.js'
import type { Tool } from './trim.js'
import { trimDiff } from './trim.js'

export interface StackFromFilesOptions {
  planFile: string
  planTextFile?: string
  metaFile?: string
  cwd?: string
  tool?: Tool
}

export async function stackFromFiles(
  options: StackFromFilesOptions
): Promise<StackPlan> {
  const cwd = options.cwd ?? process.cwd()
  const planFile = resolve(cwd, options.planFile)
  const directory = dirname(planFile)
  const metaFile = options.metaFile ?? join(directory, 'plan-meta.json')
  const meta = await readMetadata(metaFile)
  const planJson = JSON.parse(await readFile(planFile, 'utf8')) as unknown
  const counts = summarize(planJson)
  const drift = summarizeDrift(planJson)
  const planTextFile = options.planTextFile
    ? resolve(cwd, options.planTextFile)
    : null
  const actionsText = planTextFile
    ? trimDiff(await readFile(planTextFile, 'utf8'), options.tool ?? 'auto')
    : ''
  const stackPath = meta.path ?? inferPath(directory, cwd)
  const status = normalizeStatus(meta.status, counts.add + counts.change + counts.destroy)

  return {
    name: stackPath,
    path: stackPath,
    counts,
    actionsText: actionsText || null,
    drift,
    status
  }
}

export async function stackFromArtifact(
  directory: string,
  tool: Tool = 'auto'
): Promise<StackPlan> {
  const artifactDirectory = resolve(directory)
  const meta = await readMetadata(join(artifactDirectory, 'plan-meta.json'))
  const planFile = join(artifactDirectory, 'tfplan.json')
  const planTextFile = join(artifactDirectory, 'plan-clean.txt')
  const planJson = (await fileExists(planFile))
    ? (JSON.parse(await readFile(planFile, 'utf8')) as unknown)
    : null
  const counts = planJson === null ? null : summarize(planJson)
  const drift = planJson === null ? [] : summarizeDrift(planJson)
  const actionsText = (await fileExists(planTextFile))
    ? trimDiff(await readFile(planTextFile, 'utf8'), tool)
    : ''
  const stackPath = meta.path ?? basename(artifactDirectory)
  const total = counts ? counts.add + counts.change + counts.destroy : 0
  const status = normalizeStatus(meta.status, total)

  return {
    name: stackPath,
    path: stackPath,
    counts,
    actionsText: actionsText || null,
    drift,
    status
  }
}

export async function loadStacksFromArtifactRoot(
  root: string,
  tool: Tool = 'auto'
): Promise<StackPlan[]> {
  // Tolerate a missing root (e.g. the download step produced no artifacts): render
  // an empty comment rather than throwing, matching a no-stacks-to-plan run.
  if (!(await fileExists(root))) {
    return []
  }

  const entries = await readdir(root)
  const directories: string[] = []

  for (const entry of entries.sort()) {
    const fullPath = join(root, entry)
    if (entry.startsWith('plan-') && (await stat(fullPath)).isDirectory()) {
      directories.push(fullPath)
    }
  }

  // actions/download-artifact only namespaces each artifact into its own subdir
  // when it downloads more than one; a lone matched artifact is extracted flat
  // into the root (v8 made this explicit with an `artifacts.length === 1` guard).
  // Treat that flat root as a single stack so single-stack PRs aren't misreported
  // as "no changes". A failed stack has only plan-meta.json, so probe for either.
  if (directories.length === 0 && (await isArtifactDir(root))) {
    return [await stackFromArtifact(root, tool)]
  }

  return Promise.all(
    directories.map((directory) => stackFromArtifact(directory, tool))
  )
}

async function isArtifactDir(directory: string): Promise<boolean> {
  return (
    (await fileExists(join(directory, 'tfplan.json'))) ||
    (await fileExists(join(directory, 'plan-meta.json')))
  )
}

export async function expandInputFiles(
  input: string,
  cwd = process.cwd()
): Promise<string[]> {
  const patterns = input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const files = new Set<string>()

  for (const pattern of patterns) {
    const absolutePattern = isAbsolute(pattern) ? pattern : join(cwd, pattern)
    const matches = await fg(absolutePattern, {
      absolute: true,
      onlyFiles: true,
      dot: true
    })

    if (matches.length === 0 && (await fileExists(absolutePattern))) {
      files.add(absolutePattern)
      continue
    }

    for (const match of matches) {
      files.add(resolve(match))
    }
  }

  return [...files].sort()
}

interface ArtifactMetadata {
  path?: string
  status?: string
}

async function readMetadata(path: string): Promise<ArtifactMetadata> {
  if (!(await fileExists(path))) {
    return {}
  }

  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isRecord(parsed)) {
    return {}
  }

  const result: ArtifactMetadata = {}
  if (typeof parsed.path === 'string' && parsed.path.length > 0) {
    result.path = parsed.path
  }

  if (typeof parsed.status === 'string' && parsed.status.length > 0) {
    result.status = parsed.status
  }

  return result
}

function normalizeStatus(status: string | undefined, total: number): StackPlan['status'] {
  if (status === 'failure' || status === 'failed') {
    return 'failed'
  }

  if (status === 'changes' || status === 'no-changes') {
    return status
  }

  return total > 0 ? 'changes' : 'no-changes'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function inferPath(directory: string, cwd: string): string {
  const relativePath = relative(cwd, directory)
  if (relativePath && !relativePath.startsWith('..')) {
    return relativePath
  }

  return basename(directory)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
