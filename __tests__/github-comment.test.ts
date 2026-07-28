import { describe, expect, it } from 'vitest'

import {
  type GitHubComment,
  type GitHubIssuesClient,
  upsertComment
} from '../src/github/comment.js'

describe('github comment upsert', () => {
  it('creates the marker comment once and updates it on later runs', async () => {
    const octokit = new InMemoryOctokit([])

    const created = await upsertComment({
      octokit,
      owner: 'acme',
      repo: 'infra',
      issueNumber: 42,
      marker: '<!-- tf-pr-commenter -->',
      body: '<!-- tf-pr-commenter -->\nfirst'
    })
    const updated = await upsertComment({
      octokit,
      owner: 'acme',
      repo: 'infra',
      issueNumber: 42,
      marker: '<!-- tf-pr-commenter -->',
      body: '<!-- tf-pr-commenter -->\nsecond'
    })

    expect(created.id).toBe(updated.id)
    expect(octokit.createCalls).toBe(1)
    expect(octokit.updateCalls).toBe(1)
    expect(octokit.comments).toHaveLength(1)
    expect(octokit.comments[0]?.body).toBe('<!-- tf-pr-commenter -->\nsecond')
  })

  it('finds marker comments beyond the first 100 comments through pagination', async () => {
    const comments = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      body: `regular comment ${index + 1}`
    }))
    comments.push({ id: 121, body: '<!-- tf-pr-commenter -->\nold body' })
    const octokit = new InMemoryOctokit(comments)

    const result = await upsertComment({
      octokit,
      owner: 'acme',
      repo: 'infra',
      issueNumber: 42,
      marker: '<!-- tf-pr-commenter -->',
      body: '<!-- tf-pr-commenter -->\nnew body'
    })

    expect(result.id).toBe(121)
    expect(octokit.createCalls).toBe(0)
    expect(octokit.updateCalls).toBe(1)
    expect(octokit.paginateCalls).toBe(1)
    expect(octokit.comments.at(-1)?.body).toBe('<!-- tf-pr-commenter -->\nnew body')
  })
})

class InMemoryOctokit {
  public comments: GitHubComment[]
  public createCalls = 0
  public updateCalls = 0
  public paginateCalls = 0

  public rest: { issues: GitHubIssuesClient }

  public constructor(comments: GitHubComment[]) {
    this.comments = comments
    this.rest = {
      issues: {
        listComments: () => Promise.resolve({ data: this.comments.slice(0, 100) }),
        createComment: (params) => {
          this.createCalls += 1
          const comment = {
            id: nextCommentId(this.comments),
            body: params.body
          }
          this.comments.push(comment)
          return Promise.resolve({ data: comment })
        },
        updateComment: (params) => {
          this.updateCalls += 1
          const comment = this.comments.find(
            (candidate) => candidate.id === params.comment_id
          )
          if (!comment) {
            throw new Error(`comment ${params.comment_id} not found`)
          }
          comment.body = params.body
          return Promise.resolve({ data: comment })
        }
      }
    }
  }

  public paginate = (): Promise<GitHubComment[]> => {
    this.paginateCalls += 1
    return Promise.resolve(this.comments)
  }
}

function nextCommentId(comments: GitHubComment[]): number {
  return Math.max(0, ...comments.map((comment) => comment.id)) + 1
}
