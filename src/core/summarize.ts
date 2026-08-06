import { type Counts, type DriftItem, zeroCounts } from './model.js'

export function summarize(planJson: unknown): Counts {
  const counts = zeroCounts()
  const root = asRecord(planJson)
  const resourceChanges = root ? root.resource_changes : undefined

  if (!Array.isArray(resourceChanges)) {
    return counts
  }

  for (const resourceChange of resourceChanges) {
    const change = asRecord(asRecord(resourceChange)?.change)
    const actions = change?.actions

    if (!Array.isArray(actions)) {
      continue
    }

    const actionNames = actions.filter(
      (action): action is string => typeof action === 'string'
    )

    if (isSameActions(actionNames, ['create'])) {
      counts.add += 1
    } else if (isSameActions(actionNames, ['update'])) {
      counts.change += 1
    } else if (isSameActions(actionNames, ['delete'])) {
      counts.destroy += 1
    } else if (isReplacement(actionNames)) {
      counts.replace += 1
      counts.add += 1
      counts.destroy += 1
    }
  }

  return counts
}

// resource_drift lists objects Terraform found changed outside its control during
// refresh. It's a sibling of resource_changes in the plan JSON and is otherwise
// invisible in the counts, since a drift entry need not produce a planned action.
export function summarizeDrift(planJson: unknown): DriftItem[] {
  const root = asRecord(planJson)
  const resourceDrift = root ? root.resource_drift : undefined

  if (!Array.isArray(resourceDrift)) {
    return []
  }

  const items: DriftItem[] = []
  for (const entry of resourceDrift) {
    const record = asRecord(entry)
    const change = asRecord(record?.change)
    const actions = change?.actions

    if (!record || typeof record.address !== 'string' || !Array.isArray(actions)) {
      continue
    }

    const actionNames = actions.filter(
      (action): action is string => typeof action === 'string'
    )
    const action = driftAction(actionNames)

    if (action) {
      items.push({ address: record.address, action })
    }
  }

  return items
}

// Collapse the actions array to a single label. A refreshed object with no real
// change carries ['no-op'] and is dropped; delete+create is a replacement.
function driftAction(actions: string[]): string | null {
  const real = actions.filter((action) => action !== 'no-op')

  if (real.length === 0) {
    return null
  }

  if (real.includes('delete') && real.includes('create')) {
    return 'replace'
  }

  return real[0] ?? null
}

function isSameActions(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((action, index) => action === expected[index])
  )
}

function isReplacement(actions: string[]): boolean {
  return (
    actions.length === 2 &&
    actions.includes('delete') &&
    actions.includes('create')
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}
