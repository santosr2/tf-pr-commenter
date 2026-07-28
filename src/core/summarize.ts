import { type Counts, zeroCounts } from './model.js'

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
