// The convention checker itself, on synthetic configs (it checks configs, not appliances)

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DeviceDiscovery } from '@/cloud/homeassistant'
import { tombstone } from '@/cloud/homeassistant'
import { discoveryProblems, propertyProblem } from './conventions'

const config = (components: Record<string, object>) =>
    ({ device: { model: 'SYNTHETIC' }, origin: {}, components }) as unknown as DeviceDiscovery

const status = {
    platform: 'sensor',
    unique_id: '$deviceid-status',
    state_topic: '$this/status',
    name: 'Status',
    device_class: 'enum',
    options: ['Off', 'Washing'],
}

describe('convention checks', () => {
    it('accepts a conforming config and ignores tombstones', () => {
        assert.deepEqual(discoveryProblems(config({ status, old: tombstone('sensor') })), [])
    })

    it('flags each rule', () => {
        const problems = discoveryProblems(
            config({
                status,
                copy: { ...status, name: 'Copy' },
                fixed: { ...status, unique_id: '$deviceid-fixed', default_entity_id: 'sensor.x' },
                topic: { ...status, unique_id: '$deviceid-topic', state_topic: 'status' },
                enum: { ...status, unique_id: '$deviceid-enum', options: [] },
                text: { ...status, unique_id: '$deviceid-text', device_class: undefined },
                name: { ...status, unique_id: '$deviceid-name', name: 'Stan pralki', options: ['Wyłączona'] },
                prefix: { ...status, unique_id: 'name' },
            }),
        )
        assert.deepEqual(problems, [
            'component copy: duplicate unique_id $deviceid-status',
            "component fixed: don't define default_entity_id",
            'component topic: state_topic status should start with $this/',
            'component enum: an enum sensor needs options',
            "component text: options need device_class: 'enum'",
            "component name: 'Wyłączona' should be English",
            'component prefix: unique_id name should start with $deviceid-',
        ])
    })

    it('allows symbols in names and options', () => {
        assert.deepEqual(discoveryProblems(config({ status: { ...status, options: ['20 °C'] } })), [])
    })

    it('checks enum and select states against their options', () => {
        const c = config({
            status,
            mode: { platform: 'select', unique_id: '$deviceid-mode', state_topic: '$this/mode', options: ['A'] },
        })
        assert.equal(propertyProblem(c, 'status', 'Washing'), undefined)
        assert.equal(propertyProblem(c, 'status', 'None'), undefined)
        assert.equal(propertyProblem(c, 'status', 'Drying'), 'component status: "Drying" is not one of its options')
        assert.equal(propertyProblem(c, 'mode', 'B'), 'component mode: "B" is not one of its options')
        assert.equal(propertyProblem(c, 'other', 'x'), undefined)
    })
})
