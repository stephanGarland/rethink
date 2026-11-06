import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type ComponentInfo, type Connection, type Tombstone } from '../homeassistant'
import { type Metadata } from '../thinq'
import AABBDevice from './aabb_device'
import { ERRORS, TEMPERATURES, SPINS, SOIL_LEVELS, RINSES, SMART_COURSES } from './washer_common'
import { Enum } from '@/util/enum'
import { type ModelEntry } from '../registry'
import { entities } from './entities'
import { laundry } from './laundry_entities'

const STATUS_LENGTH = 39

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
    Refreshing: 14,
    'Steam softening': 15,
    Demo: 16,
    Error: 18,
})

// The thirteen dial positions of an FSR7A04PG, each confirmed by turning the dial through every
// position and reading the code it reported; the names are LG's own, from modelJson for this model.
//
// This deliberately does not use washer_common's COURSES. That table is shared across washer models
// and disagrees here: it reads 0x3a as "Bedding", where on this machine 0x3a is AI Wash - which the
// dial sweep gives by elimination. Sharing the table would mean one model's labels
// silently mislabelling another's.
//
// Courses outside this list do occur: a downloaded course whose base is not a dial position - Rinse
// + Spin, Spin, Drain, Silent Wash, Microplastic Care, Quick Tub Clean - reports that base here.
export const COURSES = Enum.of({
    // LG's enums all define 0 as nothing selected, which is what the appliance reports when it is
    // idle. Naming it keeps the select entities in a state Home Assistant will accept, and sending
    // it back is a legitimate "use this course's default".
    'Not selected': 0,
    'AI Wash': 0x3a,
    Cotton: 0x01,
    'Easy Care': 0x02,
    'Eco 40-60': 0x04,
    Duvet: 0x05,
    Mix: 0x07,
    'Sports Wear': 0x08,
    'Speed 14': 0x0c,
    'Tub Clean': 0x12,
    Wool: 0x1b,
    Delicate: 0x20,
    'Allergy SpaSteam': 0x2d,
    'Turbo Wash 39': 0x31,

    // Not dial positions. These are the base courses of downloadable programmes that have no dial
    // equivalent, and the course field reports them whenever such a programme is selected. Each was
    // identified from the downloadable course sitting on it; the old shared table names the first
    // two the same way, which corroborates them.
    'Rinse + Spin': 0x0e,
    'Spin only': 0x17, // old table: Spin + Drain. Both the Drain and Spin courses sit on it.
    'Silent Wash': 0x09,
    'Quick Tub Clean': 0x30,
    'MicroPlastic Care': 0x3b,
})

// Bit positions in the F026 options byte, and in the status record's own options field.
const OPTION_BITS: Record<string, number> = {
    turbowash: 0x01,
    crease_care: 0x02,
    steam_softener: 0x04,
    medic_rinse: 0x10,
    prewash: 0x40,
    steam: 0x80,
}

// F026 is "run this programme", not "configure": there is no way to set a field without starting a
// wash. So the settings below are held here until the start button is pressed, each defaulting to
// whatever the appliance last reported - press start without touching anything and it runs what the
// dial already says. This is the one piece of state this class keeps, and it exists because Home
// Assistant has no way to express a compound command otherwise.

export default class Device extends AABBDevice {
    /** Settings the user has chosen but not yet run, as wire codes. Cleared once a programme runs. */
    protected pending = new Map<string, number>()
    /** The last configuration the appliance reported, which is what an untouched start sends. */
    protected reported = { course: 0, soil: 0, spin: 0, temp: 0, rinse: 0, delay_end: 0, options: 0 }

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        // Ack every frame. Unacked, this appliance retransmits an envelope ten times and then stops
        // talking altogether: observed on an FSR7A04PG, which sent its serial record and one status
        // block, then repeated a single 20-byte envelope (seq 0x000c) ten times at ~1.4 s intervals
        // and went silent for the rest of the session. AABBDevice's ack format was verified against
        // the real cloud for Y_VB_Y___W.B32QEUK, which is this model's immediate sibling.
        super(HA, thinq, true)
        this.setConfig({ ...HADevice.config(meta, { name: 'LG Washer' }), components: this.components() })
    }

    /** The washer's course table. A sibling model with courses of its own overrides this. */
    protected courses(): Enum<string> {
        return COURSES
    }

    /**
     * The entities, for a sibling model to extend from `super.components()`. This runs from the
     * constructor, before any subclass field is initialized, so an override may only use module-level
     * constants and other methods that do the same.
     */
    protected components(): Record<string, ComponentInfo | Tombstone> {
        return entities({
            power: laundry.power(),
            start: laundry.start(),
            pause: laundry.pause(),
            status: laundry.status(STATUS.options),
            error: laundry.error(),
            error_message: laundry.errorMessage(ERRORS.options, { unique_id: '$deviceid-error-message' }),
            course: laundry.course(),
            temp: laundry.temperature(TEMPERATURES.options),
            spin: laundry.spin(SPINS.options),
            cycles: {
                platform: 'sensor',
                // the cloud calls it TCLCount: washes since the last Tub Clean
                name: 'Cycles since Tub Clean',
                icon: 'mdi:counter',
            },
            remote_start: laundry.remoteStart(),
            door_lock: laundry.doorLock(),
            energy: laundry.energy(),
            initial_time: laundry.initialTime(),
            remaining_time: laundry.remainingTime(),
            reserve_time: {
                platform: 'sensor',
                device_class: 'duration',
                // minutes, not the sibling's hours: this block carries HH:MM, and the two
                // other durations here are already minutes.
                unit_of_measurement: 'min',
                name: 'Reserve time',
                icon: 'mdi:timer-sand',
            },
            child_lock: laundry.childLock(),
            wrinkle_care: laundry.wrinkleCare({ name: 'Wrinkle care', icon: 'mdi:tshirt-crew' }),
            soil: laundry.soilLevel(SOIL_LEVELS.options, { icon: 'mdi:washing-machine' }),
            set_course: {
                platform: 'select',
                name: 'Set course',
                icon: 'mdi:tune-vertical',
                options: this.courses().options,
            },
            set_temp: {
                platform: 'select',
                name: 'Set temperature',
                icon: 'mdi:thermometer',
                options: TEMPERATURES.options,
            },
            set_spin: {
                platform: 'select',
                name: 'Set spin',
                icon: 'mdi:autorenew',
                options: SPINS.options,
            },
            set_rinse: {
                platform: 'select',
                name: 'Set rinse',
                icon: 'mdi:water',
                options: RINSES.options,
            },
            set_soil: {
                platform: 'select',
                name: 'Set soil level',
                icon: 'mdi:washing-machine',
                options: SOIL_LEVELS.options,
            },
            set_delay_end: {
                platform: 'number',
                name: 'Set delayed end',
                icon: 'mdi:timer-sand',
                unit_of_measurement: 'h',
                // 0 is off; the appliance accepts 3..19 per modelJson's reserveTimeHour.
                min: 0,
                max: 19,
                step: 1,
            },
            run_programme: {
                platform: 'button',
                payload_press: '',
                name: 'Run programme',
                icon: 'mdi:play-box-outline',
            },
            set_steam: {
                platform: 'switch',
                name: 'Set steam',
                icon: 'mdi:kettle-steam',
            },
            set_prewash: {
                platform: 'switch',
                name: 'Set pre-wash',
                icon: 'mdi:water-sync',
            },
            set_turbowash: {
                platform: 'switch',
                name: 'Set TurboWash',
                icon: 'mdi:rocket-launch',
            },
            set_crease_care: {
                platform: 'switch',
                name: 'Set crease care',
                icon: 'mdi:iron-outline',
            },
            set_steam_softener: {
                platform: 'switch',
                name: 'Set steam softener',
                icon: 'mdi:kettle-steam-outline',
            },
            set_medic_rinse: {
                platform: 'switch',
                name: 'Set medic rinse',
                icon: 'mdi:water-check',
            },
            smart_course: {
                platform: 'sensor',
                name: 'Downloaded course',
                icon: 'mdi:cloud-download-outline',
                device_class: 'enum',
                options: SMART_COURSES.options,
            },
            rinse: laundry.rinse(RINSES.options),
            turbowash: laundry.turboWash(),
            steam: laundry.steam(),
            steam_softener: {
                platform: 'binary_sensor',
                name: 'Steam softener',
                icon: 'mdi:kettle-steam-outline',
            },
            prewash: laundry.preWash(),
            crease_care: {
                platform: 'binary_sensor',
                name: 'Crease care',
                icon: 'mdi:iron-outline',
            },
            medic_rinse: {
                platform: 'binary_sensor',
                name: 'Medic rinse',
                icon: 'mdi:water-check',
            },
            ai_dd: {
                platform: 'binary_sensor',
                name: 'AI DD',
                icon: 'mdi:brain',
            },
        })
    }

    start() {
        this.send(Buffer.from('F0ED1121010000001800', 'hex'))
    }

    // The appliance sends its state enveloped, mostly as 0xec pairs (the state being replaced, then
    // the state replacing it) and only rarely as a single 0xeb record. Both carry the same 39-byte
    // record.
    processAABB(buf: Buffer) {
        this.processEnvelopedStatus(buf, 0x20, STATUS_LENGTH, this.processState)
    }

    // Offsets into the 39-byte state record. The wiki's byte map (Appliance:Y_V8_Y___W.B32QEUK)
    // describes the 0xeb framing, so its offsets are these plus the 13-byte envelope header.
    processState(s: Buffer) {
        const status = s[2]
        const time_remain = s[3] * 60 + s[4]
        const time_initial = s[5] * 60 + s[6]
        const course = s[7]
        const error = s[8]
        const soil = s[9]
        const spin = s[10]
        const temp = s[11]
        const rinse = s[12]
        // s[13] is dryLevel, which this washer has no drum heater for and never sets.
        const time_reserve = s[14] * 60 + s[15]
        const options = s[16]
        const lock_status = s[17]
        const aidd = s[18]
        // s[21] is preState, the status this record supersedes.
        // s[22] is the downloaded course actually selected, s[25] the one loaded in the download
        // slot. They read identically across a full cycle on this unit - the machine holds one
        // downloaded course at a time (modelJson: maxDownloadCourseNum 1) - so only s[22] is
        // published. Y_VB_Y___W.B32QEUK reports 0 at s[22] while nothing downloaded is selected and
        // the slot's content at s[25], so that model publishes s[25] too.
        const smart_course = s[22]
        const cycles = s[23]
        // The wiki leaves 30/31 unnamed, but the sibling's energy counter sits at the same place in
        // its own record, and it is the only value here that climbs monotonically through a cycle and
        // then holds. s[34]/s[35] - where this file used to read energy - are the auto-dispenser's
        // detergent and softener amounts, which is why energy always read 0 on a machine with no
        // such hardware.
        const energy = s[30] * 256 + s[31]

        this.publishProperty('power', status > 0 ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS.map(error)) // publish message before set error state
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', STATUS.map(status))
        // Unknown codes are logged, which is what lets the tables be completed from a capture.
        const courseName = this.courses().map(course)
        if (courseName === undefined) this.log('undecoded course', course.toString(16))
        this.publishProperty('course', courseName)
        const smartCourseName = SMART_COURSES.map(smart_course)
        if (smart_course && smartCourseName === undefined) {
            this.log('undecoded downloaded course', smart_course.toString(16))
        }
        this.publishProperty('smart_course', smartCourseName)
        this.publishProperty('spin', SPINS.map(spin))
        this.publishProperty('temp', TEMPERATURES.map(temp))
        this.publishProperty('cycles', cycles)
        this.publishProperty('remote_start', lock_status & 2 ? 'ON' : 'OFF')
        this.publishProperty('door_lock', !(lock_status & 0x40) ? 'ON' : 'OFF') // inverted logic, off=locked
        this.publishProperty('child_lock', !(lock_status & 0x80) ? 'ON' : 'OFF') // inverted, as door_lock
        this.publishProperty('wrinkle_care', lock_status & 0x20 ? 'ON' : 'OFF')
        this.publishProperty('initial_time', time_initial)
        this.publishProperty('remaining_time', time_remain)
        this.publishProperty('reserve_time', time_reserve)
        this.publishProperty('energy', energy)
        this.publishProperty('soil', SOIL_LEVELS.map(soil))
        this.publishProperty('rinse', RINSES.map(rinse))
        this.publishProperty('turbowash', options & 0x01 ? 'ON' : 'OFF')
        this.publishProperty('crease_care', options & 0x02 ? 'ON' : 'OFF')
        this.publishProperty('steam_softener', options & 0x04 ? 'ON' : 'OFF')
        // options & 0x08 is ecoHybrid, a heat-pump dryer option this washer does not have, and
        // options & 0x20 is rinseSpin, which duplicates the Rinse + Spin course. Neither is
        // published until a unit is seen setting them.
        this.publishProperty('medic_rinse', options & 0x10 ? 'ON' : 'OFF')
        this.publishProperty('prewash', options & 0x40 ? 'ON' : 'OFF')
        this.publishProperty('steam', options & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('ai_dd', aidd & 0x01 ? 'ON' : 'OFF')

        this.reported = { course, soil, spin, temp, rinse, delay_end: s[14], options }
        this.publishSettings()
    }

    /** A setting's effective value: what the user chose, or failing that what the appliance reports. */
    protected setting(prop: keyof typeof this.reported) {
        return this.pending.get(prop) ?? this.reported[prop]
    }

    /** Republish every set_* entity. Called on each state record and after each write. */
    protected publishSettings() {
        this.publishProperty('set_course', this.courses().map(this.setting('course')))
        this.publishProperty('set_temp', TEMPERATURES.map(this.setting('temp')))
        this.publishProperty('set_spin', SPINS.map(this.setting('spin')))
        this.publishProperty('set_rinse', RINSES.map(this.setting('rinse')))
        this.publishProperty('set_soil', SOIL_LEVELS.map(this.setting('soil')))
        this.publishProperty('set_delay_end', this.setting('delay_end'))
        const options = this.setting('options')
        for (const [name, bit] of Object.entries(OPTION_BITS)) {
            this.publishProperty(`set_${name}`, options & bit ? 'ON' : 'OFF')
        }
    }

    /**
     * F0 26 <course> <soilWash> <spin> <temp> <rinse> <dryLevel> <reserveH> <reserveM> <loadItem>
     *       <options> <flags> 00 <smartCourse> 00 00 00
     *
     * Confirmed against a start issued from the LG app - Allergy SpaSteam at 60 C with steam came
     * over the bridge as F0262D03FF06010000000080030000000000 - and against the three examples on
     * the project wiki, whose course, soilWash, spin, temp and rinse bytes each match modelJson's
     * documented defaults for the course they name.
     *
     * The three trailing zeros are the ezDispense detergent level, softener level and dispense type
     * on the sibling Y_VB_Y___W.B32QEUK, which has the hardware; zero is off for the first two.
     *
     * The 0x03 byte is initialBit | remoteStart. Every observed start carries it, and upstream
     * records elsewhere that a washer's initialBit has to be set even though a bare 0 looks equally
     * off on paper, so it is sent rather than left clear.
     *
     * NOTE: Downloading & starting downloaded programmes is not yet implemented.
     */
    protected programmeCommand() {
        return Buffer.from([
            0xf0,
            0x26,
            this.setting('course'),
            this.setting('soil'),
            this.setting('spin'),
            this.setting('temp'),
            this.setting('rinse'),
            0, // dryLevel: this washer has no drum heater
            this.setting('delay_end'),
            0, // reserveTimeMinute: the panel only offers whole hours
            0, // loadItemWasher
            this.setting('options'),
            0x03, // initialBit | remoteStart
            0,
            0,
            0,
            0,
            0,
        ])
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

        if (prop === 'run_programme') {
            this.send(this.programmeCommand())
            // The appliance is now the authority on what is running; drop the pending choices so the
            // entities follow it again rather than showing a selection that has already been used.
            this.pending.clear()
            return
        }

        const table: Record<string, Enum<string>> = {
            set_course: this.courses(),
            set_temp: TEMPERATURES,
            set_spin: SPINS,
            set_rinse: RINSES,
            set_soil: SOIL_LEVELS,
        }
        if (prop in table) {
            const code = table[prop].unmap(mqttValue)
            if (code !== undefined) this.pending.set(prop.slice(4), code)
            this.publishSettings()
            return
        }

        if (prop === 'set_delay_end') {
            const hours = Number(mqttValue)
            // modelJson allows 3..19; 0 is how the panel expresses "no delayed end".
            if (Number.isFinite(hours) && (hours === 0 || (hours >= 3 && hours <= 19))) {
                this.pending.set('delay_end', hours)
            }
            this.publishSettings()
            return
        }

        const bit = OPTION_BITS[prop.slice(4)]
        if (prop.startsWith('set_') && bit !== undefined) {
            const options = this.setting('options')
            this.pending.set('options', mqttValue === 'ON' ? options | bit : options & ~bit)
            this.publishSettings()
        }
    }
}

export const models: ModelEntry[] = [
    {
        category: 'Washing machines',
        ids: ['Y_V8_Y___W.B32QEUK'],
        appliance: 'FSR7A04PG, Front-Loading Washing Machine',
        support: '👍 mostly working',
    },
]
