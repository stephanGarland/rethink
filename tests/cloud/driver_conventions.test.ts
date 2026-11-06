// CONTRIBUTING.md rules that span drivers. Per-config rules (tests/helpers/conventions.ts) run in
// every device test through MockHAConnection.

import { after, before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { drivers, factoryOf } from '@/cloud/registry'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq1Device, MockThinq2Device } from '../helpers/mocks'

// Drivers without a test file. Don't add to this.
const UNTESTED = new Set(['WIN_056905_WW'])

// Entity names spelled with different capitalization in different drivers. HA uses sentence case;
// pick one spelling for each and remove it here. Don't add to this.
const KNOWN_NAME_VARIANTS = new Set([
    'auto conversion',
    'delay wash',
    'energy saver',
    'extra rinse',
    'oven door',
    'oven mode',
    'oven status',
    'preheating alarm light',
    'temperature unit',
    'washes since tub clean',
    'wrinkle care',
])

describe('driver conventions', () => {
    // Drivers that publish their discovery config on construction; the rest publish it once the
    // appliance reports its capabilities, which only their own tests (with captured frames) reach.
    const configs: { module: string; names: string[] }[] = []

    before(() => {
        mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
        for (const driver of drivers) {
            for (const entry of driver.models) {
                const id = entry.ids[0]
                const meta = { modelId: id, modelName: id, swVersion: '1.0' } as Metadata
                const ha = new MockHAConnection()
                const thinq =
                    entry.platform === 'thinq1' ? new MockThinq1Device('dev', meta) : new MockThinq2Device('dev', meta)
                const Factory = factoryOf(driver, entry) as new (...args: unknown[]) => unknown
                new Factory(ha.asConnection(), thinq, meta)
                const config = ha.devices.dev?.config
                if (!config) continue
                const names = Object.values(config.components)
                    .map((c) => ('name' in c ? c.name : undefined))
                    .filter((n): n is string => typeof n === 'string' && n !== '')
                configs.push({ module: driver.module, names })
            }
        }
    })

    after(() => mock.timers.reset())

    it('gives every driver a test file', () => {
        const tests = fs.readdirSync(new URL('./devices/', import.meta.url))
        const untested = drivers
            .map((d) => d.module)
            .filter((m) => !UNTESTED.has(m) && !tests.some((t) => t === `${m}.test.ts` || t.startsWith(`${m}.`)))
        assert.deepEqual(untested, [], 'add tests/cloud/devices/<module>.test.ts, using captured frames')
    })

    it('spells each entity name the same way in every driver', () => {
        const spellings = new Map<string, Map<string, string>>() // lowercase -> spelling -> a module
        for (const { module, names } of configs)
            for (const name of names) {
                const key = name.toLowerCase()
                if (!spellings.has(key)) spellings.set(key, new Map())
                spellings.get(key)!.set(name, module)
            }
        const variants = [...spellings]
            .filter(([key, s]) => s.size > 1 && !KNOWN_NAME_VARIANTS.has(key))
            .map(([, s]) => [...s].map(([name, module]) => `'${name}' (${module})`).join(' vs '))
        assert.deepEqual(variants, [], 'use the spelling the other drivers use')
    })

    it('keeps the known exceptions current', () => {
        const stale = [...KNOWN_NAME_VARIANTS].filter(
            (key) => new Set(configs.flatMap((c) => c.names).filter((n) => n.toLowerCase() === key)).size < 2,
        )
        assert.deepEqual(stale, [], 'these are consistent now; remove them from KNOWN_NAME_VARIANTS')
        const tested = [...UNTESTED].filter((m) => fs.existsSync(new URL(`./devices/${m}.test.ts`, import.meta.url)))
        assert.deepEqual(tested, [], 'these have tests now; remove them from UNTESTED')
    })
})
