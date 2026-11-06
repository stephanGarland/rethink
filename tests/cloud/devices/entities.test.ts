// entities() derives IDs and topics; synthetic specs, since it builds configs rather than decoding frames

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tombstone } from '@/cloud/homeassistant'
import { entities } from '@/cloud/devices/entities'
import { laundry } from '@/cloud/devices/laundry_entities'

describe('entities', () => {
    it('derives unique_id and topics from the key, per platform', () => {
        const c = entities({
            status: { platform: 'sensor', name: 'Status' },
            power: { platform: 'switch', name: '' },
            start: { platform: 'button', name: 'Start' },
        })
        assert.deepEqual(c.status, {
            platform: 'sensor',
            unique_id: '$deviceid-status',
            state_topic: '$this/status',
            name: 'Status',
        })
        assert.deepEqual(c.power, {
            platform: 'switch',
            unique_id: '$deviceid-power',
            state_topic: '$this/power',
            command_topic: '$this/power/set',
            name: '',
        })
        assert.deepEqual(c.start, {
            platform: 'button',
            unique_id: '$deviceid-start',
            command_topic: '$this/start/set',
            name: 'Start',
        })
    })

    it('keeps what a spec sets, and passes tombstones through', () => {
        const old = tombstone('sensor')
        const c = entities({
            error_message: { platform: 'sensor', unique_id: '$deviceid-error-message', state_topic: '$this/error' },
            gone: old,
        })
        assert.deepEqual(c.error_message, {
            platform: 'sensor',
            unique_id: '$deviceid-error-message',
            state_topic: '$this/error',
        })
        assert.equal(c.gone, old)
    })

    it('applies catalog overrides over the defaults', () => {
        const spec = laundry.status(['Off', 'On'], { icon: 'mdi:tumble-dryer' })
        assert.equal(spec.name, 'Status')
        assert.equal(spec.icon, 'mdi:tumble-dryer')
        assert.deepEqual(spec.options, ['Off', 'On'])
    })
})
