// Checks for the CONTRIBUTING.md rules that a machine can verify. MockHAConnection runs them on
// every discovery config and property a device test publishes, so each device test enforces them
// for its driver without asserting anything itself.

import type { DeviceDiscovery } from '@/cloud/homeassistant'

type Component = Record<string, unknown> & { platform: string }

// Letters outside ASCII suggest a non-English name; symbols such as '°C' are fine
const NON_ENGLISH = /[^\x00-\x7F]/u
const hasNonAsciiLetter = (s: string) => [...s].some((c) => NON_ENGLISH.test(c) && /\p{L}/u.test(c))

function components(config: DeviceDiscovery) {
    // a tombstone has only `platform`
    return Object.entries(config.components).filter(([, c]) => Object.keys(c).length > 1) as [string, Component][]
}

export function discoveryProblems(config: DeviceDiscovery): string[] {
    const problems: string[] = []
    const uniqueIds = new Set<string>()
    for (const [key, c] of components(config)) {
        const where = `component ${key}`
        if ('default_entity_id' in c) problems.push(`${where}: don't define default_entity_id`)

        // Not derived from the key strictly: existing drivers spell it several ways, and changing a
        // unique_id orphans the HA entity
        const uid = c.unique_id as string
        if (!uid?.startsWith('$deviceid-')) problems.push(`${where}: unique_id ${uid} should start with $deviceid-`)
        if (uniqueIds.has(uid)) problems.push(`${where}: duplicate unique_id ${uid}`)
        uniqueIds.add(uid)

        for (const t of ['state_topic', 'command_topic'])
            if (typeof c[t] === 'string' && !(c[t] as string).startsWith('$this/'))
                problems.push(`${where}: ${t} ${c[t]} should start with $this/`)

        if (c.platform === 'sensor') {
            const options = c.options as unknown[] | undefined
            if (c.device_class === 'enum' && !options?.length) problems.push(`${where}: an enum sensor needs options`)
            if (options && c.device_class !== 'enum') problems.push(`${where}: options need device_class: 'enum'`)
        }

        for (const text of [c.name, ...((c.options as unknown[]) ?? [])])
            if (typeof text === 'string' && hasNonAsciiLetter(text))
                problems.push(`${where}: '${text}' should be English`)
    }
    return problems
}

// Values HA rejects: an enum sensor's or a select's state outside its options. 'None' is accepted
// unconditionally (publishProperty maps undefined to it).
export function propertyProblem(config: DeviceDiscovery | undefined, property: string, value: unknown) {
    if (!config || value === 'None') return undefined
    for (const [key, c] of components(config)) {
        if (c.state_topic !== `$this/${property}`) continue
        const enumerated = (c.platform === 'sensor' && c.device_class === 'enum') || c.platform === 'select'
        const options = c.options as unknown[] | undefined
        if (enumerated && options && !options.includes(value))
            return `component ${key}: ${JSON.stringify(value)} is not one of its options`
    }
    return undefined
}
