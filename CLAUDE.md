# tf-pr-commenter

A bundled JavaScript GitHub Action. `action.yml` points at `dist/index.js`, so the
built bundle is a committed artifact, not build output you can ignore.

## dist/ is committed and CI enforces it

`mise run package` builds `lib/` with tsc and bundles it into `dist/` with ncc.
CI runs `git diff --exit-code -- dist`, so a PR whose `dist/` does not match its
source and lockfile fails.

- Never hand-edit `dist/`. Change `src/`, then run `mise run package`.
- Any change to `src/`, `templates/`, or a production dependency needs a rebuilt
  `dist/` in the same PR.
- `mise run ci` is the full local equivalent of the CI job.

## Node version is pinned in three places

`mise.toml` (`node = "24"`), `action.yml` (`runs.using: node24`), and
`package.json` (`engines.node`). A Node major upgrade has to move all three
together, and `@types/node` follows the same major. Dependabot is configured to
ignore `@types/node` majors for that reason.

## Dependabot

`.github/dependabot.yml` groups minor and patch updates so majors still arrive as
individual PRs. `.github/workflows/dependabot-dist.yml` rebuilds and pushes
`dist/` on Dependabot PRs, since Dependabot updates manifests without running the
build.

Consequence worth knowing: Dependabot abandons a branch once anyone else commits
to it, so it will not rebase or force-update these PRs after the bundle is pushed.
Close and reopen the PR to get a fresh one.
