import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { tombstone, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { ERRORS, COURSES, TEMPERATURES, SPINS, SOIL_LEVELS, DOSES } from './washer_common'
import { Enum } from '@/util/enum'
import { entities } from './entities'
import { laundry } from './laundry_entities'

// Codes derived from modelJSON & observation of the LG app.
const STATUS = Enum.of({
    Off: 0,
    Standby: 1,
    Paused: [2, 19], // the second is AUTO_DT_OPEN_PAUSE, shows as 'Paused' in the app
    Delayed: 3,
    Detecting: 4,
    Washing: 6,
    Rinsing: 7,
    Spinning: 8,
    Drying: 9,
    End: 10,
    'Cool down': 11,
    'Rinse hold': 12,
    Refreshing: 14,
    'Steam softening': 15,
    Demo: 16,
    Error: 18,
})

export default class Device extends AABBDevice {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, true)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Washer' }),
                components: entities({
                    power: laundry.power(),
                    start: laundry.start(),
                    pause: laundry.pause(),
                    status: laundry.status(STATUS.options),
                    error: laundry.error(),
                    error_message: laundry.errorMessage(ERRORS.options, { unique_id: '$deviceid-error-message' }),
                    course: laundry.course(),
                    temp: laundry.temperature(TEMPERATURES.options),
                    spin: laundry.spin(SPINS.options),
                    cycles: laundry.cycles(),
                    remote_start: laundry.remoteStart(),
                    door_lock: laundry.doorLock(),
                    energy: laundry.energy(),
                    initial_time: laundry.initialTime(),
                    remaining_time: laundry.remainingTime(),
                    reserve_time: {
                        platform: 'sensor',
                        device_class: 'duration',
                        unit_of_measurement: 'h',
                        name: 'Reserve time',
                        icon: 'mdi:timer-sand',
                    },
                    detergent: laundry.detergent(DOSES.options),
                    softener: laundry.softener(DOSES.options),
                    extra_rinse: laundry.extraRinse(),
                    turbowash: laundry.turboWash(),
                    prewash: laundry.preWash(),
                    soil: laundry.soilLevel(SOIL_LEVELS.options, { icon: 'mdi:washing-machine' }),
                    intensive_wash: tombstone('binary_sensor'),
                    steam: laundry.steam(),
                }),
            }),
        )
    }

    start() {
        this.send(Buffer.from('F0ED1121010000001800', 'hex'))
    }

    processAABB(buf: Buffer) {
        this.processCommonStatus(buf, 0x20, 39, this.processStatus)
    }

    processStatus(buf: Buffer) {
        const status = buf[2]
        const time_remain = buf[3] * 60 + buf[4]
        const time_initial = buf[5] * 60 + buf[6]
        const course = buf[7]
        const error = buf[8]
        const soil = buf[9]
        const spin = buf[10]
        const temp = buf[11]
        const extra_rinse = buf[12]
        const time_reserve_hour = buf[14]
        const options = buf[16]
        const lock_status = buf[17]
        const cycles = buf[23]
        const energy = buf[30] * 256 + buf[31]
        const detergent = buf[32]
        const softener = buf[33]

        this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS.map(error)) // publish message before set error state
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATUS.map(status))
        this.publishProperty('course', COURSES.map(course))
        this.publishProperty('spin', SPINS.map(spin))
        this.publishProperty('temp', TEMPERATURES.map(temp))
        this.publishProperty('cycles', cycles)
        this.publishProperty('remote_start', lock_status & 2 ? 'ON' : 'OFF')
        this.publishProperty('door_lock', !(lock_status & 0x40) ? 'ON' : 'OFF') // inverted logic, off=locked
        this.publishProperty('initial_time', time_initial)
        this.publishProperty('remaining_time', time_remain)
        this.publishProperty('reserve_time', time_reserve_hour)
        this.publishProperty('energy', energy)
        this.publishProperty('detergent', DOSES.map(detergent))
        this.publishProperty('softener', DOSES.map(softener))
        this.publishProperty('extra_rinse', extra_rinse >= 2 ? 'ON' : 'OFF') // 0/1=off, 2+=one or more extra rinses (Rinse+)
        this.publishProperty('turbowash', options & 0x01 ? 'ON' : 'OFF')
        this.publishProperty('prewash', options & 0x40 ? 'ON' : 'OFF')
        this.publishProperty('steam', options & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('soil', SOIL_LEVELS.map(soil))
    }

    setProperty(prop: string, mqttValue: string) {
        if (prop === 'power') {
            if (mqttValue === 'ON') {
                this.send(Buffer.from('F02A0100', 'hex'))
            } else if (mqttValue === 'OFF') {
                this.send(Buffer.from('F024010100', 'hex'))
            }
        }

        if (prop === 'pause') this.send(Buffer.from('F024040100', 'hex'))
        if (prop === 'start') this.send(Buffer.from('F024050100', 'hex'))
    }
}
