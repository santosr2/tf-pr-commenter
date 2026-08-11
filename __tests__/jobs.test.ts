import { describe, expect, it } from 'vitest'

import {
  failedJobsBanner,
  failedOrCancelledNames,
  jobUrlsByStack,
  listRunJobs,
  type JobSummary
} from '../src/github/jobs.js'

describe('failedOrCancelledNames', () => {
  it('returns only jobs that failed or were cancelled, keeping order', () => {
    const failed = failedOrCancelledNames([
      job('Plan (a)', 'success'),
      job('Plan (b)', 'failure'),
      job('Policy Check', 'cancelled'),
      job('Post PR Summary', null) // the commenter's own job, still running
    ])

    expect(failed).toEqual(['Plan (b)', 'Policy Check'])
  })
})

describe('listRunJobs', () => {
  it('returns [] when the jobs API throws (e.g. no actions: read)', async () => {
    const octokit: InMemoryJobsOctokit = new InMemoryJobsOctokit([])
    octokit.paginate = () => Promise.reject(new Error('403 Forbidden'))

    const jobs = await listRunJobs({
      octokit,
      owner: 'acme',
      repo: 'infra',
      runId: 123
    })

    expect(jobs).toEqual([])
  })
})

describe('jobUrlsByStack', () => {
  // Real shapes from a Terragrunt matrix: GitHub truncates the matrix portion at 100 chars
  // (note the "..."), but the reusable workflow's child suffix keeps the full path.
  const jobs = [
    job('Plan (dev, us-east-2, demo, common, cdn, dev/us-east-2/demo/common/cdn) / plan - dev/us-east-2/demo/common/cdn'),
    job('Plan (dev, us-east-2, moon, data_platform, airflow, dev/us-east-2/moon/data_platform/air... / plan - dev/us-east-2/moon/data_platform/airflow'),
    job('Policy Check (dev, us-east-2, demo, common, cdn, dev/us-east-2/demo/common/cdn)'),
    job('Post PR Summary')
  ]

  it('links a stack to the matching plan job and ignores the policy job', () => {
    const urls = jobUrlsByStack(jobs, ['dev/us-east-2/demo/common/cdn'], /plan/iu)

    expect(urls.get('dev/us-east-2/demo/common/cdn')).toBe(jobs[0]?.html_url)
    expect(urls.get('dev/us-east-2/demo/common/cdn')).not.toBe(jobs[2]?.html_url)
  })

  it('matches a path that survives only in the truncated name suffix', () => {
    const urls = jobUrlsByStack(
      jobs,
      ['dev/us-east-2/moon/data_platform/airflow'],
      /plan/iu
    )

    expect(urls.has('dev/us-east-2/moon/data_platform/airflow')).toBe(true)
  })

  it('does not let a longer path claim a shorter one', () => {
    const urls = jobUrlsByStack(
      [job('Plan (envs/prod/app-2) / plan - envs/prod/app-2')],
      ['envs/prod/app'],
      /plan/iu
    )

    expect(urls.has('envs/prod/app')).toBe(false)
  })

  it('omits stacks with no matching job so they render unlinked', () => {
    const urls = jobUrlsByStack(jobs, ['envs/staging/new'], /plan/iu)

    expect(urls.size).toBe(0)
  })

  it('returns no urls when the jobs list is empty', () => {
    expect(jobUrlsByStack([], ['dev/us-east-2/demo/common/cdn'], /plan/iu).size).toBe(0)
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

let nextJobId = 0

function job(name: string, conclusion: string | null = 'success'): JobSummary {
  return {
    name,
    conclusion,
    html_url: `https://github.com/acme/infra/actions/runs/1/job/${nextJobId++}`
  }
}

class InMemoryJobsOctokit {
  public rest = { actions: { listJobsForWorkflowRun: 'listJobsForWorkflowRun' } }

  public constructor(private readonly jobs: JobSummary[]) {}

  public paginate = (): Promise<JobSummary[]> => Promise.resolve(this.jobs)
}
