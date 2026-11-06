// Driver registry. Every module in cloud/devices/ that exports `models` is a driver: its default
// export handles the ThinQ model IDs listed there. Adding a driver therefore touches only its own
// file (plus its test), never a shared list. The README's device list is generated from the same
// entries (`npm run device-list`).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type HADevice from './devices/base'
import type { Connection } from './homeassistant'
import type { Metadata } from './thinq'
import type { Device as T1Device } from './thinq1/device'
import type { Device as T2Device } from './thinq2/device'

export type Platform = 'thinq1' | 'thinq2'

// README headings, in the order they appear there
export const CATEGORIES = [
    'Air conditioners',
    'Fridges',
    'Washing machines',
    'Dryers',
    'WashTowers (combined washer+dryer)',
    'Dishwashers',
    'Dehumidifiers',
    'Range hoods',
    'Ovens and ranges',
    'Microwave ovens',
    'Stylers',
] as const

export type Category = (typeof CATEGORIES)[number]

// One row of the README's device list
export type ModelEntry = {
    // Defaults to 'thinq2'
    platform?: Platform
    category: Category
    // ThinQ model IDs (`meta.modelId`) handled by this entry's driver
    ids: string[]
    // The module's named export that handles these IDs, for a module with several drivers.
    // Defaults to its default export.
    driver?: string
    // Marketing model name(s) and appliance kind, e.g. 'WM4200HBA, Front-Load Washing Machine'
    appliance: string
    support: string
}

type T1Factory = new (HA: Connection, thinq: T1Device, metadata: Metadata) => HADevice
type T2Factory = new (HA: Connection, thinq: T2Device, metadata: Metadata) => HADevice

export type Factory = T1Factory | T2Factory

export type Driver = {
    // module file name without the extension
    module: string
    exports: Record<string, unknown>
    models: ModelEntry[]
}

export function factoryOf(driver: Driver, entry: ModelEntry) {
    return driver.exports[entry.driver ?? 'default'] as Factory | undefined
}

// Modules in cloud/devices/ that are shared code rather than drivers, so they don't export `models`
export const SHARED_MODULES = new Set([
    'base',
    'aabb_device',
    'tlv_device',
    'washer_common',
    'fridge_common',
    'dishwasher_common',
])

const devicesDir = fileURLToPath(new URL('./devices/', import.meta.url))

async function loadDrivers(): Promise<Driver[]> {
    // .ts under tsx (dev, tests), .js in the build
    const files = fs
        .readdirSync(devicesDir)
        .filter((f) => /\.[jt]s$/.test(f) && !f.endsWith('.d.ts'))
        .sort()

    const drivers: Driver[] = []
    for (const file of files) {
        const module = file.replace(/\.[jt]s$/, '')
        const mod = await import(pathToFileURL(path.join(devicesDir, file)).href)
        if (mod.models === undefined) {
            if (!SHARED_MODULES.has(module))
                console.warn(`cloud/devices/${file} exports no models; it is not registered as a driver`)
            continue
        }
        drivers.push({ module, exports: mod, models: mod.models })
    }
    return drivers
}

export const drivers = await loadDrivers()

const lookup: Record<Platform, Map<string, { module: string; factory: Factory }>> = {
    thinq1: new Map(),
    thinq2: new Map(),
}
for (const driver of drivers) {
    for (const entry of driver.models) {
        const platform = entry.platform ?? 'thinq2'
        const factory = factoryOf(driver, entry)
        if (typeof factory !== 'function')
            throw new Error(`${driver.module} has no export ${entry.driver ?? 'default'} for ${entry.ids.join(', ')}`)
        for (const id of entry.ids) {
            const other = lookup[platform].get(id)
            if (other)
                throw new Error(`${platform} model ${id} is claimed by both ${other.module} and ${driver.module}`)
            lookup[platform].set(id, { module: driver.module, factory })
        }
    }
}

export function findDriver(platform: 'thinq1', modelId: string): T1Factory | undefined
export function findDriver(platform: 'thinq2', modelId: string): T2Factory | undefined
export function findDriver(platform: Platform, modelId: string) {
    return lookup[platform].get(modelId)?.factory
}
