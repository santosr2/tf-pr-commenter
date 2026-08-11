export interface JobSummary {
  name: string
  conclusion: string | null
  html_url: string
}

export interface WorkflowRunJobsClient {
  paginate: (
    endpoint: unknown,
    params: { owner: string; repo: string; run_id: number; per_page: number }
  ) => Promise<JobSummary[]>
  rest: {
    actions: {
      listJobsForWorkflowRun: unknown
    }
  }
}

export interface RunJobsOptions {
  octokit: WorkflowRunJobsClient
  owner: string
  repo: string
  runId: number
}

// Every job in this run. Returns [] on any error — e.g. the token lacks `actions: read` —
// so the comment still renders, just without job-derived detail.
export async function listRunJobs(
  options: RunJobsOptions
): Promise<JobSummary[]> {
  try {
    return await options.octokit.paginate(
      options.octokit.rest.actions.listJobsForWorkflowRun,
      {
        owner: options.owner,
        repo: options.repo,
        run_id: options.runId,
        per_page: 100
      }
    )
  } catch {
    return []
  }
}

// Names of jobs that failed or were cancelled. The commenter's own job is still running
// (conclusion null) while this executes, so it is excluded naturally.
export function failedOrCancelledNames(jobs: JobSummary[]): string[] {
  return jobs
    .filter(
      (job) => job.conclusion === 'failure' || job.conclusion === 'cancelled'
    )
    .map((job) => job.name)
}

// Stack path to job URL, for stacks whose path appears in a matching job's name. A matrix
// job name embeds the stack path; GitHub truncates the matrix portion at 100 chars, but a
// reusable workflow's child suffix ("… / plan - envs/prod/app") keeps the full path, so a
// substring match survives truncation. Stacks with no match are simply absent.
export function jobUrlsByStack(
  jobs: JobSummary[],
  stackPaths: string[],
  pattern: RegExp
): Map<string, string> {
  const candidates = jobs.filter((job) => pattern.test(job.name))
  const urls = new Map<string, string>()

  for (const path of stackPaths) {
    const match = candidates.find((job) => nameContainsPath(job.name, path))
    if (match) {
      urls.set(path, match.html_url)
    }
  }

  return urls
}

// Bounded substring match, so a job for `envs/prod/app-2` never claims `envs/prod/app`.
function nameContainsPath(name: string, path: string): boolean {
  for (
    let index = name.indexOf(path);
    index !== -1;
    index = name.indexOf(path, index + 1)
  ) {
    const before = name[index - 1] ?? ' '
    const after = name[index + path.length] ?? ' '
    if (!isPathChar(before) && !isPathChar(after)) {
      return true
    }
  }

  return false
}

function isPathChar(char: string): boolean {
  return /[\w./-]/u.test(char)
}

// A one-line blockquote naming the failed/cancelled jobs, so a comment rendered from
// artifacts alone never reads as success while a job actually failed or produced no output
// (e.g. an account run-all, or a cancelled job). Returns '' when there is nothing to warn.
export function failedJobsBanner(names: string[]): string {
  if (names.length === 0) {
    return ''
  }
  const shown = names.slice(0, 10)
  const remainder = names.length - shown.length
  const list = shown.map((name) => `\`${name}\``).join(', ')
  const suffix = remainder > 0 ? `, +${remainder} more` : ''
  const noun = names.length === 1 ? 'job' : 'jobs'
  const verb = names.length === 1 ? 'was' : 'were'
  return `> ⚠️ **${names.length} ${noun} failed or ${verb} cancelled** in this run and may not appear below — check the run's jobs: ${list}${suffix}`
}
