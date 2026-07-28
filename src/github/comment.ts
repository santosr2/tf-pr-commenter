export interface GitHubComment {
  id: number
  body?: string | null
}

export interface GitHubIssuesClient {
  listComments: unknown
  createComment: (
    params: {
      owner: string
      repo: string
      issue_number: number
      body: string
    }
  ) => Promise<{ data: GitHubComment }>
  updateComment: (
    params: {
      owner: string
      repo: string
      comment_id: number
      body: string
    }
  ) => Promise<{ data: GitHubComment }>
}

export interface GitHubClient {
  paginate: (
    endpoint: unknown,
    params: {
      owner: string
      repo: string
      issue_number: number
      per_page: number
    }
  ) => Promise<GitHubComment[]>
  rest: {
    issues: GitHubIssuesClient
  }
}

export interface UpsertCommentOptions {
  octokit: GitHubClient
  owner: string
  repo: string
  issueNumber: number
  body: string
  marker: string
}

export async function upsertComment(
  options: UpsertCommentOptions
): Promise<GitHubComment> {
  const comments = await options.octokit.paginate(
    options.octokit.rest.issues.listComments,
    {
      owner: options.owner,
      repo: options.repo,
      issue_number: options.issueNumber,
      per_page: 100
    }
  )
  const existing = comments.find((comment) =>
    (comment.body ?? '').startsWith(options.marker)
  )

  if (existing) {
    const response = await options.octokit.rest.issues.updateComment({
      owner: options.owner,
      repo: options.repo,
      comment_id: existing.id,
      body: options.body
    })
    return response.data
  }

  const response = await options.octokit.rest.issues.createComment({
    owner: options.owner,
    repo: options.repo,
    issue_number: options.issueNumber,
    body: options.body
  })
  return response.data
}
