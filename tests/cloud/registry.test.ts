import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CATEGORIES, SHARED_MODULES, drivers, factoryOf, findDriver } from '@/cloud/registry'
import { README, renderReadme } from '@/tools/device-list'
import HADevice from '@/cloud/devices/base'

describe('driver registry', () => {
    it('registers every module in cloud/devices/ that is not shared code', () => {
        const modules = fs
            .readdirSync(new URL('../../cloud/devices/', import.meta.url))
            .filter((f) => f.endsWith('.ts'))
            .map((f) => f.replace(/\.ts$/, ''))
        const registered = new Set(drivers.map((d) => d.module))
        const unregistered = modules.filter((m) => !registered.has(m) && !SHARED_MODULES.has(m))
        assert.deepEqual(unregistered, [], 'export `models` from these, or add them to SHARED_MODULES')
    })

    it('registers HADevice subclasses with well-formed entries', () => {
        for (const driver of drivers) {
            const { module, models } = driver
            assert.ok(models.length > 0, `${module}: empty models`)
            for (const entry of models) {
                const factory = factoryOf(driver, entry)
                assert.ok(
                    factory?.prototype instanceof HADevice,
                    `${module}: ${entry.ids[0]}'s driver is not an HADevice`,
                )
                assert.ok(entry.ids.length > 0, `${module}: entry without ids`)
                assert.ok(CATEGORIES.includes(entry.category), `${module}: unknown category ${entry.category}`)
                assert.ok(entry.appliance && entry.support, `${module}: ${entry.ids[0]} needs appliance and support`)
            }
        }
    })

    it('looks drivers up per platform', () => {
        // RAC_056905_WW is handled by different drivers on ThinQ1 and ThinQ2
        assert.equal(findDriver('thinq2', 'RAC_056905_WW')?.name, 'Device')
        assert.notEqual(findDriver('thinq1', 'RAC_056905_WW'), findDriver('thinq2', 'RAC_056905_WW'))
        assert.ok(findDriver('thinq1', 'RAC_056905_WW'))
        assert.equal(findDriver('thinq2', 'WTDN3'), undefined)
        assert.equal(findDriver('thinq2', 'NOT_A_MODEL'), undefined)
    })

    it('keeps the README device list in sync with the drivers', async () => {
        const current = fs.readFileSync(README, 'utf8')
        assert.ok((await renderReadme(current)) === current, 'README.md is out of date: run `npm run device-list`')
    })
})
