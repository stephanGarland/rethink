import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { ERRORS, COURSES, TEMPERATURES, SPINS, DRYING_MODES } from './washer_common'
import { Enum } from '@/util/enum'
import { entities } from './entities'
import { laundry } from './laundry_entities'

// Codes derived from modelJSON & observation of the LG app.
const STATUS = Enum.of({
    Off: 0,
    Standby: 1,
    Paused: 2,
    Delayed: 3,
    Detecting: 4,
    Washing: 6,
    Rinsing: 7,
    Spinning: 8,
    Drying: 9,
    End: 10,
    'Cool down': 11,
    'Rinse hold': 12,
    Refreshing: [14, 15], // WASH_REFRESHING & REFRESHING,
    // the app shows the first one as a wash state, the second as a sub-state of Completed
    Demo: 16,
    Error: 18,
})

export default class Device extends AABBDevice {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, false)
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
                    drying_mode: laundry.dryingMode({ unique_id: '$deviceid-drying-mode' }),
                    cycles: laundry.cycles(),
                    remote_start: laundry.remoteStart(),
                    door_lock: laundry.doorLock(),
                    energy: laundry.energy(),
                    initial_time: laundry.initialTime(),
                    remaining_time: laundry.remainingTime(),
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
        const spin = buf[10]
        const temp = buf[11]
        const drying_mode = buf[13]
        const lock_status = buf[17]
        const cycles = buf[23]
        const energy = buf[30] * 256 + buf[31]

        this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS.map(error))
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATUS.map(status))
        this.publishProperty('course', COURSES.map(course))
        this.publishProperty('spin', SPINS.map(spin))
        this.publishProperty('temp', TEMPERATURES.map(temp))
        this.publishProperty('drying_mode', DRYING_MODES.map(drying_mode))
        this.publishProperty('cycles', cycles)
        this.publishProperty('remote_start', lock_status & 2 ? 'ON' : 'OFF')
        this.publishProperty('door_lock', !(lock_status & 0x40) ? 'ON' : 'OFF') // inverted logic, off=locked
        this.publishProperty('initial_time', time_initial)
        this.publishProperty('remaining_time', time_remain)
        this.publishProperty('energy', energy)
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
