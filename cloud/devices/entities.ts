import { type ComponentInfo, type Tombstone } from '../homeassistant'

// A component as a driver writes it: `unique_id` and the topics may be left out, and `entities()`
// derives them from the component's key.
export type EntitySpec = Omit<ComponentInfo, 'unique_id'> & { unique_id?: string; [field: string]: unknown }

// Platforms that report a state, and those that take commands
const STATEFUL = new Set(['sensor', 'binary_sensor', 'switch', 'select', 'number'])
const COMMANDED = new Set(['switch', 'button', 'select', 'number'])

/**
 * Builds discovery components from specs keyed by component key. Fills in what each spec leaves
 * out:
 *
 * - `unique_id`: `$deviceid-<key>`
 * - `state_topic`: `$this/<key>`, for platforms that report a state
 * - `command_topic`: `$this/<key>/set`, for platforms that take commands
 *
 * A spec that sets any of these keeps its own value, so entities whose IDs predate this (and must not
 * change, or HA would orphan them) are written out in full. Tombstones pass through.
 */
export function entities(specs: Record<string, EntitySpec | Tombstone>): Record<string, ComponentInfo | Tombstone> {
    const out: Record<string, ComponentInfo | Tombstone> = {}
    for (const [key, spec] of Object.entries(specs)) {
        // a tombstone has only `platform`
        if (Object.keys(spec).length === 1) {
            out[key] = spec as Tombstone
            continue
        }
        const { platform } = spec
        out[key] = {
            unique_id: `$deviceid-${key}`,
            ...(STATEFUL.has(platform) && { state_topic: `$this/${key}` }),
            ...(COMMANDED.has(platform) && { command_topic: `$this/${key}/set` }),
            ...spec,
        } as ComponentInfo
    }
    return out
}
