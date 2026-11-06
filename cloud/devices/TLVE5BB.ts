import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { Enum } from '@/util/enum'
import { type ModelEntry } from '../registry'
import { entities } from './entities'
import { laundry } from './laundry_entities'

// LG WT21BWV6 top-load washer, matched on modelId "TLVE5BB" (thinq2 deviceType 201).
//
// The appliance uses the long AABB envelope also seen on FAFXU25006, but its 0xEC frames contain two
// 50-byte records rather than two 72-byte records. The first record is the previous state and the
// second is current. The core state and time offsets match LG's newer washer layout.

const STATUS_REQUEST = 'F0ED112101000000180411120000'

const CLASS_BYTE = 0x20
const RECORD_LEN = 50

const SOIL_OFFSET = 1
const TEMP_OFFSET = 2
const RINSES_REMAINING_OFFSET = 3
const SPIN_OFFSET = 4
const REMAIN_TIME_OFFSET = 14
const INITIAL_TIME_OFFSET = 16
const ENERGY_OFFSET = 18
const STATE_OFFSET = 21
const TUB_CLEAN_COUNT_OFFSET = 28
const BUZZER_OFFSET = 29
const LID_LOCK_OFFSET = 38
const STATE_POWEROFF = 0

const STATUS = Enum.of({
    Off: 0,
    Standby: [1, 27], // +FROZEN_PREVENT_INITIAL
    Paused: [2, 28], // +FROZEN_PREVENT_PAUSE
    Detecting: 3,
    Filling: 5,
    'Detergent amount': 6,
    Delayed: 7,
    Soaking: 8,
    'Pre-wash': 9,
    Washing: [11, 29], // +FROZEN_PREVENT_RUNNING
    Rinsing: 12,
    'Rinse hold': 13,
    Spinning: 14,
    Drying: 15,
    End: 16,
    Refreshing: 21,
    Error: 23, // ERROR_AUTO_OFF

    // I have no way to determine what these codes actually mean or if the are used, leaving untouched.
    'Audible diagnosis': 34,
    'Auto DT open pause': 35,
    'Confirm start for control': 36,
    'Clothing recognition': 37,
    'Detergent input': 38,
    'Softener input': 39,
    'Pollution detecting': 40,
    'Tub cleaning': 41,
    'End remote maintain on': 42,
    Steam: 43,
    'Laundry care': 47,
    'EZDispense cleaning': 48,
    'Dry cooling': 52,
})

const SOIL = Enum.of({
    Light: 1,
    'Light/Normal': 2,
    Normal: 3,
    'Normal/Heavy': 4,
    Heavy: 5,
    'Pre-wash': 6,
    Soaking: 7,
    TurboWash: 8,
    'Time save': 9,
    Intensive: 10,
})

const SPIN = Enum.of({
    Low: 13,
    Medium: 14,
    High: 15,
    'Extra High': 16,
    'Dry Intensive': 17,
    Delicate: 18,
})

const TEMP = Enum.of({
    Cold: 8,
    Warm: 9,
    Hot: 10,
    'Cold/Hot': 12,
})

const BUZZER = Enum.of({
    Off: 0,
    Low: 1,
    Medium: 2,
    High: 3,
    'Very loud': 4,
})

export default class Device extends AABBDevice {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, false)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Washer' }),
                components: entities({
                    power: {
                        platform: 'binary_sensor',
                        name: 'Power',
                        icon: 'mdi:washing-machine',
                        device_class: 'running',
                    },
                    status: laundry.status(STATUS.options),
                    remaining_time: laundry.remainingTime({ icon: 'mdi:timer-outline' }),
                    initial_time: laundry.initialTime({ icon: 'mdi:timer-sand' }),
                    energy: laundry.energy(),
                    soil: laundry.soilLevel(SOIL.options),
                    temp: laundry.temperature(TEMP.options, { icon: 'mdi:thermometer' }),
                    spin: laundry.spin(SPIN.options),
                    rinses_remaining: {
                        platform: 'sensor',
                        name: 'Rinses remaining',
                        icon: 'mdi:water-sync',
                        state_class: 'measurement',
                    },
                    tub_clean_count: laundry.tubCleanCount(),
                    buzzer: laundry.buzzer(BUZZER.options),
                    lid_lock: {
                        platform: 'binary_sensor',
                        name: 'Lid lock',
                        icon: 'mdi:lock',
                        entity_category: 'diagnostic',
                    },
                }),
            }),
        )
    }

    start() {
        this.send(Buffer.from(STATUS_REQUEST, 'hex'))
    }

    processAABB(buf: Buffer) {
        this.processEnvelopedStatus(buf, CLASS_BYTE, RECORD_LEN, this.processStatus)
    }

    private processStatus(rec: Buffer) {
        const state = rec[STATE_OFFSET]
        const isOff = state === STATE_POWEROFF

        this.publishProperty('power', isOff ? 'OFF' : 'ON')
        this.publishProperty('status', STATUS.map(state))
        this.publishProperty('remaining_time', isOff ? 0 : rec.readUInt16LE(REMAIN_TIME_OFFSET))
        this.publishProperty('initial_time', isOff ? 0 : rec.readUInt16LE(INITIAL_TIME_OFFSET))
        this.publishProperty('energy', rec.readUInt16LE(ENERGY_OFFSET))
        this.publishProperty('soil', SOIL.map(rec[SOIL_OFFSET]))
        this.publishProperty('temp', TEMP.map(rec[TEMP_OFFSET]))
        this.publishProperty('spin', SPIN.map(rec[SPIN_OFFSET]))
        this.publishProperty('rinses_remaining', rec[RINSES_REMAINING_OFFSET])
        this.publishProperty('tub_clean_count', rec[TUB_CLEAN_COUNT_OFFSET])
        this.publishProperty('buzzer', BUZZER.map(rec[BUZZER_OFFSET]))
        this.publishProperty('lid_lock', rec[LID_LOCK_OFFSET] !== 0 ? 'ON' : 'OFF')
    }
}

export const models: ModelEntry[] = [
    // LG WT21BWV6 top-load washer, long 0xFF-escaped AABB framing with 50-byte records
    {
        category: 'Washing machines',
        ids: ['TLVE5BB'],
        appliance: 'WT21BWV6, Top-Load Washing Machine',
        support: '🫤 preliminary, read-only',
    },
]
