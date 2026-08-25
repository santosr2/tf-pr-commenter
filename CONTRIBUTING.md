# Contributing

## Setup

```bash
mise install
mise run install
```

`mise.toml` pins the toolchain. `mise run install` is `npm ci`, so it installs from the
lockfile rather than resolving fresh.

## Everyday commands

| Command | What it does |
|---|---|
| `mise run check` | Template generation check plus `tsc --noEmit` |
| `mise run lint` | ESLint |
| `mise run test` | Vitest |
| `mise run package` | Builds `lib/` with tsc, bundles `dist/` with ncc |
| `mise run ci` | All of the above, in the order CI runs them |

`mise run ci` is the full local equivalent of the CI job. Run it before pushing.

## `dist/` is a committed artifact

`action.yml` points at `dist/index.js`, so GitHub Actions executes the committed bundle
rather than building anything. CI enforces this with `git diff --exit-code -- dist`, and a
PR whose `dist/` does not match its source and lockfile fails.

- Never hand-edit `dist/`. Change `src/`, then run `mise run package`.
- Any change to `src/`, `templates/`, or a production dependency needs a rebuilt `dist/` in
  the same PR.

A consequence worth internalising: `@vercel/ncc` is a devDependency but behaves like a
production one, because a bundler major rewrites the shipped artifact wholesale.

## The Node major is pinned in three places

`mise.toml` (`node = "24"`), `action.yml` (`runs.using: node24`), and `package.json`
(`engines.node`). A Node major upgrade has to move all three together, and `@types/node`
follows the same major, which is why Dependabot is configured to ignore its majors.

## Commits

Conventional commits: `<type>(<scope>): <description>`, imperative mood, lowercase, no
trailing period. Types in use: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.

`main` carries a `required_signatures` ruleset, so **every commit must be signed and
verified**, and commits carry a DCO sign-off:

```bash
git commit -s   # signs via commit.gpgsign, adds Signed-off-by
```

Never reach for `--no-gpg-sign`, `--no-signoff`, or `--no-verify`. An unsigned commit
cannot land on `main`.

## Pull requests

The `main` ruleset requires one approving review, resolution of every review thread, and
rejects force-pushes and deletion. There is no required-status-check rule, so **green CI is
a convention rather than an enforced gate** — check it before merging.

Squash merge, so each PR becomes one commit on `main`.

Bodies follow three sections: `## What and why`, `## How to test`, `## Notes for
reviewers`.

## Dependabot

`.github/dependabot.yml` groups minor and patch updates so majors arrive as individual PRs.
`.github/workflows/dependabot-dist.yml` rebuilds and pushes `dist/` on Dependabot branches,
since Dependabot updates manifests without running the build.

Two behaviours that will otherwise cost you an afternoon:

- **Dependabot abandons a branch once anyone else commits to it**, so it will not rebase or
  force-update a PR after the bundle is pushed. `@dependabot recreate` rebuilds the branch
  from current `main`; closing and reopening also works.
- **The rebuild commit is unsigned**, because the workflow commits with the git CLI from the
  runner. Combined with `required_signatures` and the ruleset's
  `require_extra_approval_for_unattributed_changes`, any bump needing a dist rebuild lands
  blocked pending a second approval.

A related trap: a push made with `GITHUB_TOKEN` does not trigger workflow runs. When the
rebuild job pushes, the new head can end up with no checks at all, and the PR reads as
unblocked rather than unverified. Confirm checks ran against the head SHA:

```bash
gh api repos/santosr2/tf-pr-commenter/commits/$(gh pr view <N> --json headRefOid --jq .headRefOid)/check-runs \
  --jq '.check_runs[] | "\(.name): \(.conclusion)"'
```

## Releasing

Releases are manual; there is no release workflow. Consumers pin an exact tag, so a change
is inert until a version exists to bump to.

### Versioning

`0.x`, and the precedent is narrower than semver alone implies:

- **Minor** for a plan layout the action previously could not read at all: v0.4.0 drift,
  v0.5.0 outputs, v0.6.0 unchanged stacks, v0.7.0 `terragrunt run --all`.
- **Patch** for corrected output (v0.6.1) or dependency maintenance with no behaviour change
  (v0.7.1).

An input change or a field added to or removed from the template model is a minor, since
custom templates are part of the contract.

### Steps

1. Branch from current `main`, named `chore/release-vX.Y.Z`.

2. Bump the version:

   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```

   Use `npm version` rather than editing by hand. `package-lock.json` repeats the project
   version twice near the top, and unrelated packages further down can coincidentally carry
   the same version string.

3. Commit `package.json` and `package-lock.json` only. A release commit touches nothing
   else; land source and docs changes in their own PRs first.

4. Open a PR titled `feat: release vX.Y.Z` (this title is used for patch releases too) and
   merge it once CI is green.

5. Tag the merge commit with a **signed annotated tag** whose message is the version string:

   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"   # signs via tag.gpgsign
   git push origin vX.Y.Z
   ```

   Tags are annotated and signed, not lightweight. There is no moving major tag (no `v0`);
   consumers pin exact versions.

6. Publish the release against that tag:

   ```bash
   gh release create vX.Y.Z --title vX.Y.Z --notes-file <notes>
   ```

### Release notes

Hand-written, not generated from commit subjects. The established shape:

- The early-stage `> [!WARNING]` block, carried verbatim from the previous release.
- `## What's Changed` — prose explaining the behaviour that changed and why it was wrong or
  missing before. Not a commit list.
- `## Upgrading` — what consumers must do, and explicitly what is unaffected (inputs,
  template model, custom templates).
- `## Verification` — what was actually run.
- `**Full Changelog**: https://github.com/santosr2/tf-pr-commenter/compare/vPREV...vNEW`
