# tf-pr-commenter

The commenter for when one PR plans many Terraform or Terragrunt stacks.

`tf-pr-commenter` renders one aggregated, budget-aware pull-request comment from many
`terraform show -json` files. It always keeps the per-stack summary complete, then adds colored
per-stack diffs while they fit under GitHub's comment limit. Detail is dropped whole with an explicit
omission note, never blind-truncated mid-diff.

> [!WARNING]
> This is an early-stage project and has not been tested in real Terraform/Terragrunt pull-request
> workflows yet. Review the rendered comment output carefully before relying on it for production
> infrastructure changes.

## Usage

```yaml
name: Terraform plan comment

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  comment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: santosr2/tf-pr-commenter@v0.1.0
        with:
          plan-files: 'artifacts/**/tfplan.json'
          plan-text-files: 'artifacts/**/plan-clean.txt'
          header: '🏗️ Terraform Plan'
```

The plan step is intentionally separate. Generate and upload static plan JSON/text artifacts in your
own Terraform or Terragrunt jobs, then run this low-privilege comment job without cloud credentials.

## Example output

A run over three stacks renders one comment: a complete summary table for every stack, then colored
per-stack diffs for those that fit the budget. The block below is a live render, so GitHub colors the
diff exactly as it appears in the posted comment — `+` green (add), `-` red (destroy), and `!` orange
(change or replace).

---

## 🏗️ Terraform Plan — 3 stacks

| Stack | Plan | Status |
|---|---|---|
| `envs/prod/networking` | `+2 ~1 -2` | ✅ |
| `envs/prod/app` | `+0 ~1 -0` | ✅ ⚠️ 1 drifted |
| `envs/staging/logging` | — | ⚪ |

<details><summary>📋 <code>envs/prod/networking</code> <code>+2 ~1 -2</code></summary>

```diff
+   resource "aws_s3_bucket" "logs" {
+       bucket = "logs"
    }

!   resource "aws_instance" "app" {
!       tags = {
-           "old" = "yes"
+           "new" = "yes"
        }
    }

!   resource "aws_lb" "main" {
!       name = "old" -> "new"
    }

-   resource "aws_iam_role" "old" {
-       name = "old-role"
    }
```

</details>

<details><summary>📋 <code>envs/prod/app</code> <code>+0 ~1 -0</code> ⚠️ 1 drifted</summary>

```diff
!   resource "aws_db_instance" "app" {
!       deletion_protection = false -> true
    }
```

**⚠️ Changed outside Terraform:**

```diff
  # aws_db_instance.app has changed
!   resource "aws_db_instance" "app" {
+       domain_dns_ips = []
    }
```

</details>

---

The colors come from GitHub's diff highlighter, not from the action. Terraform's `~` (in-place update)
and `-/+` (replace) markers are rewritten to `!` and moved to column 0 so the highlighter renders them
as changed lines. Stacks with no changes show `—` and a ⚪ status, and their detail block is skipped
entirely. When detail blocks would exceed `char-budget`, whole stacks are dropped with an explicit
omission note while the summary table above stays complete.

A `⚠️ N drifted` badge marks stacks where Terraform detected objects changed **outside** Terraform.
The drift is taken from Terraform's own "Objects have changed outside of Terraform" report (its
schema-filtered view — so it excludes computed and `ignore_changes` churn) and rendered in a separate
"Changed outside Terraform" block. A stack can be drift-only: `+0 ~0 -0` with a badge and a drift block
but no plan actions.

Set `show-outputs: true` to also surface Terraform's "Changes to Outputs" section as a `Δ N outputs`
badge and an "Output changes" block. It is off by default because output-only diffs are the
lowest-signal channel — they often just read `(sensitive value)` and mean no real infrastructure
changed.

<details><summary>Raw Markdown the action posts</summary>

````markdown
<!-- tf-pr-commenter -->

## 🏗️ Terraform Plan — 3 stacks

| Stack | Plan | Status |
|---|---|---|
| `envs/prod/networking` | `+2 ~1 -2` | ✅ |
| `envs/prod/app` | `+0 ~1 -0` | ✅ ⚠️ 1 drifted |
| `envs/staging/logging` | — | ⚪ |

<details><summary>📋 <code>envs/prod/networking</code> <code>+2 ~1 -2</code></summary>

```diff
+   resource "aws_s3_bucket" "logs" {
+       bucket = "logs"
    }

!   resource "aws_instance" "app" {
...
```

</details>

<details><summary>📋 <code>envs/prod/app</code> <code>+0 ~1 -0</code> ⚠️ 1 drifted</summary>

```diff
!   resource "aws_db_instance" "app" {
!       deletion_protection = false -> true
    }
```

**⚠️ Changed outside Terraform:**

```diff
  # aws_db_instance.app has changed
!   resource "aws_db_instance" "app" {
+       domain_dns_ips = []
    }
```

</details>
````

</details>

## Inputs

| Input | Description | Default |
|---|---|---|
| `plan-files` | Required newline list or glob of `terraform show -json` files. | |
| `plan-text-files` | Optional newline list or glob of raw plan text files, paired to plan files by directory. | |
| `github-token` | Token with `pull-requests: write`. | `${{ github.token }}` |
| `header` | Comment title. | `🏗️ Terraform Plan` |
| `marker` | Hidden HTML marker used to update one comment in place. | `<!-- tf-pr-commenter -->` |
| `char-budget` | Maximum rendered comment chars. | `65000` |
| `template` | Inline Eta template or path to a `.eta` template. | bundled default |
| `tool` | `auto`, `terraform`, or `terragrunt`; controls plan text prefix stripping. | `auto` |
| `show-outputs` | Surface the "Changes to Outputs" section as a `Δ N outputs` badge and an "Output changes" block. Off by default (lowest-signal channel). | `false` |

## Template Model

Templates use Eta. A template can provide a detail section and a shell section:

````eta
<!-- tf-pr-commenter:detail -->
<details><summary><%= it.stack.name %></summary>
```diff
<%~ it.stack.actionsText + '\n' %>
```
</details>
<!-- tf-pr-commenter:shell -->
## <%= it.header %>
<%~ it.detailSections.join('\n\n') %>
````

The shell receives the render model plus `detailSections`, which are pre-rendered detail blocks that
fit the budget.

| Field | Description |
|---|---|
| `header` | Comment title. |
| `marker` | Hidden upsert marker. |
| `stacks` | Every stack, always complete for summary tables. |
| `details` | Stack subset whose detail blocks fit the budget. |
| `detailSections` | Rendered detail Markdown for `details`. |
| `omittedCount` | Number of stack detail blocks dropped to fit the budget. |
| `totals` | Summed `add`, `change`, `destroy`, and `replace` counts. |
| `statusIcon` | Status to icon map for `changes`, `no-changes`, and `failed`. |

Each stack has `name`, `path`, `counts`, `actionsText`, `driftText`, `outputsText`, `status`,
`countsLine`, `planCell`, `total`, `statusIcon`, `driftCount`, and `outputsCount`. `driftText` is
Terraform's rendered "Objects have changed outside of Terraform" block (or null) and `driftCount`
the resources in it; `outputsText` is the "Changes to Outputs" block (or null, and always null unless
`show-outputs` is on) and `outputsCount` the number of top-level outputs changed.

See `templates/default.eta`, `examples/compact.eta`, and `examples/grouped-by-action.eta`.

## CLI

```bash
npm install
npm run build
node lib/cli/index.js plan-artifacts
```

The default CLI mode reads `plan-*` artifact directories with `plan-meta.json`, `tfplan.json`, and
`plan-clean.txt`, matching the reference Python implementation. It can also read explicit plan files:

```bash
node lib/cli/index.js \
  --plan-files 'artifacts/**/tfplan.json' \
  --plan-text-files 'artifacts/**/plan-clean.txt'
```

## Comparison

| Tool | Fit for many stacks in one PR |
|---|---|
| `liatrio/terraform-change-pr-commenter` | One invocation per plan. |
| `suzuki-shunsuke/tfcmt` | Runs planning itself for one workspace, not static many-stack artifacts. |
| `robburger/terraform-pr-commenter` | Needs initialized modules and credentials in the comment job. |
| `tf-pr-commenter` | Reads static artifacts, renders one marker-keyed comment, keeps summary complete, and budget-drops detail whole. |

## Development

```bash
mise install
mise run install
mise run check
mise run test
mise run package
```

`dist/` is committed because GitHub Actions execute the bundled JavaScript.
