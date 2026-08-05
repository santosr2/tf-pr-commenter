import { describe, expect, it } from 'vitest'

import {
  failedJobsBanner,
  failedOrCancelledJobs,
  type JobSummary
} from '../src/github/jobs.js'

describe('failedOrCancelledJobs', () => {
  it('returns only jobs that failed or were cancelled, keeping order', async () => {
    const octokit = new InMemoryJobsOctokit([
      { name: 'Plan (a)', conclusion: 'success' },
      { name: 'Plan (b)', conclusion: 'failure' },
      { name: 'Policy Check', conclusion: 'cancelled' },
      { name: 'Post PR Summary', conclusion: null } // the commenter's own job, still running
    ])

    const failed = await failedOrCancelledJobs({
      octokit,
      owner: 'acme',
      repo: 'infra',
      runId: 123
    })

    expect(failed).toEqual(['Plan (b)', 'Policy Check'])
  })

  it('returns [] when the jobs API throws (e.g. no actions: read)', async () => {
    const octokit: InMemoryJobsOctokit = new InMemoryJobsOctokit([])
    octokit.paginate = () => Promise.reject(new Error('403 Forbidden'))

    const failed = await failedOrCancelledJobs({
      octokit,
      owner: 'acme',
      repo: 'infra',
      runId: 123
    })

    expect(failed).toEqual([])
  })
})

describe('failedJobsBanner', () => {
  it('returns an empty string when nothing failed', () => {
    expect(failedJobsBanner([])).toBe('')
  })

  it('renders a singular banner with the job name', () => {
    const banner = failedJobsBanner(['Plan (dev/us-east-2/workera (run-all))'])
    expect(banner).toContain('⚠️')
    expect(banner).toContain('**1 job failed or was cancelled**')
    expect(banner).toContain('`Plan (dev/us-east-2/workera (run-all))`')
    expect(banner.startsWith('> ')).toBe(true)
  })

  it('pluralises and truncates a long list', () => {
    const names = Array.from({ length: 13 }, (_, index) => `job-${index}`)
    const banner = failedJobsBanner(names)
    expect(banner).toContain('**13 jobs failed or were cancelled**')
    expect(banner).toContain('+3 more')
    expect(banner).toContain('`job-0`')
    expect(banner).not.toContain('`job-10`')
  })
})

class InMemoryJobsOctokit {
  public rest = { actions: { listJobsForWorkflowRun: 'listJobsForWorkflowRun' } }

  public constructor(private readonly jobs: JobSummary[]) {}

  public paginate = (): Promise<JobSummary[]> => Promise.resolve(this.jobs)
}
