import HADevice from './base'
import { Device as Thinq1Device } from '../thinq1/device'
import { type Connection } from '../homeassistant'
import { allowExtendedType } from '@/util/casting'
import { Metadata } from '../thinq'
import { ERRORS, COURSES, TEMPERATURES, SPINS, DRYING_MODES } from './washer_common'
import { Enum } from '@/util/enum'
import { entities } from './entities'
import { laundry } from './laundry_entities'

// copied from the former shared washer_common table, to be validated.
export const STATUS = Enum.of({
    Off: 0,
    Standby: 1,
    Paused: [2, 19],
    Delayed: 3,
    Detecting: 4,
    'Pre-wash': 5,
    Washing: 6,
    Rinsing: 7,
    Spinning: 8,
    Drying: 9,
    End: 10,
    Cooling: 11,
    'Rinse hold': 12,
    Refreshing: 14,
    'Steam softening': 15,
    Demo: 16,
    Error: 18,
})

export default class Device extends HADevice {
    constructor(
        HA: Connection,
        readonly thinq: Thinq1Device,
        meta: Metadata,
    ) {
        super(HA, thinq.id, meta.modelId)
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
                    initial_time: laundry.initialTime(),
                    remaining_time: laundry.remainingTime(),
                }),
            }),
        )

        thinq.on('data', (buf) => {
            if (buf.length == 28) {
                const status = buf[0]
                const time_remain = buf[1] * 60 + buf[2]
                const time_initial = buf[3] * 60 + buf[4]
                const native_course = buf[5]
                const error = buf[6]
                const spin = buf[8]
                const temp = buf[9]
                const drying_mode = buf[11]
                const lock_status = buf[15]
                const custom_course = buf[20]
                const cycles = buf[21]

                this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
                this.publishProperty('error_message', ERRORS.map(error)) // publish message before set error state
                this.publishProperty('error', error ? 'ON' : 'OFF')
                this.publishProperty('status', STATUS.map(status))
                this.publishProperty('course', COURSES.map(custom_course) ?? COURSES.map(native_course))
                this.publishProperty('spin', SPINS.map(spin))
                this.publishProperty('temp', TEMPERATURES.map(temp))
                this.publishProperty('drying_mode', DRYING_MODES.map(drying_mode))
                this.publishProperty('cycles', cycles)
                this.publishProperty('remote_start', lock_status & 2 ? 'ON' : 'OFF')
                this.publishProperty('door_lock', !(lock_status & 0x40) ? 'ON' : 'OFF') // inverted logic, off=locked
                this.publishProperty('initial_time', time_initial)
                this.publishProperty('remaining_time', time_remain)
            }
        })
    }

    start() {
        this.thinq.send({ Cmd: 'Mon', CmdOpt: 'Start' })
    }

    setProperty(prop: string, mqttValue: string) {
        if (prop === 'power') {
            if (mqttValue === 'ON') {
                this.thinq.send({ Cmd: 'Control', CmdOpt: 'Power', Value: 'On', Format: 'B64', Data: '' })
            } else if (mqttValue === 'OFF') {
                this.thinq.send({ Cmd: 'Control', CmdOpt: 'Power', Value: 'Off', Format: 'B64', Data: '' })
            }
        }
        if (prop === 'pause')
            this.thinq.send({ Cmd: 'Control', CmdOpt: 'Operation', Value: 'Stop', Format: 'B64', Data: '' })
        if (prop === 'start')
            this.thinq.send({ Cmd: 'Control', CmdOpt: 'Operation', Value: 'Start', Format: 'B64', Data: mqttValue })
    }
}
