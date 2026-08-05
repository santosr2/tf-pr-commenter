export interface JobSummary {
  name: string
  conclusion: string | null
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

export interface FailedJobsOptions {
  octokit: WorkflowRunJobsClient
  owner: string
  repo: string
  runId: number
}

// Names of jobs in the run that failed or were cancelled. The commenter's own job is still
// running (conclusion null) while this executes, so it is excluded naturally. Returns [] on
// any error — e.g. the token lacks `actions: read` — so the comment still renders.
export async function failedOrCancelledJobs(
  options: FailedJobsOptions
): Promise<string[]> {
  try {
    const jobs = await options.octokit.paginate(
      options.octokit.rest.actions.listJobsForWorkflowRun,
      {
        owner: options.owner,
        repo: options.repo,
        run_id: options.runId,
        per_page: 100
      }
    )
    return jobs
      .filter(
        (job) => job.conclusion === 'failure' || job.conclusion === 'cancelled'
      )
      .map((job) => job.name)
  } catch {
    return []
  }
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
