import { type EntitySpec } from './entities'

type Overrides = Partial<EntitySpec>

const entity =
    (base: EntitySpec) =>
    (overrides: Overrides = {}): EntitySpec => ({ ...base, ...overrides })

// for enum sensors, which list their states
const enumSensor =
    (base: EntitySpec) =>
    (options: readonly string[], overrides: Overrides = {}): EntitySpec => ({ ...base, options, ...overrides })

// Entities that washers and dryers share, for `entities()`. Each sets the name, icon and classes
// most drivers use; a driver passes overrides where its appliance differs.
export const laundry = {
    power: entity({ platform: 'switch', name: '', icon: 'mdi:washing-machine' }),
    start: entity({ platform: 'button', payload_press: '', name: 'Start', icon: 'mdi:play-circle-outline' }),
    pause: entity({ platform: 'button', payload_press: '', name: 'Pause', icon: 'mdi:pause-circle-outline' }),
    status: enumSensor({ platform: 'sensor', name: 'Status', icon: 'mdi:state-machine', device_class: 'enum' }),
    error: entity({
        platform: 'binary_sensor',
        name: 'Error',
        icon: 'mdi:check-circle',
        device_class: 'problem',
        entity_category: 'diagnostic',
    }),
    errorMessage: enumSensor({
        platform: 'sensor',
        name: 'Error message',
        icon: 'mdi:alert-circle-outline',
        device_class: 'enum',
        entity_category: 'diagnostic',
    }),
    course: entity({ platform: 'sensor', name: 'Course', icon: 'mdi:pin-outline' }),
    temperature: enumSensor({ platform: 'sensor', name: 'Temperature', device_class: 'enum' }),
    spin: enumSensor({ platform: 'sensor', name: 'Spin', icon: 'mdi:autorenew', device_class: 'enum' }),
    initialTime: entity({
        platform: 'sensor',
        device_class: 'duration',
        unit_of_measurement: 'min',
        name: 'Initial time',
    }),
    remainingTime: entity({
        platform: 'sensor',
        device_class: 'duration',
        unit_of_measurement: 'min',
        name: 'Remaining time',
    }),
    reserveTime: entity({
        platform: 'sensor',
        name: 'Delay Wash time remaining',
        icon: 'mdi:clock-outline',
        device_class: 'duration',
        unit_of_measurement: 'min',
    }),
    remoteStart: entity({ platform: 'binary_sensor', name: 'Remote start', icon: 'mdi:play-circle-outline' }),
    door: entity({ platform: 'binary_sensor', name: 'Door', device_class: 'door' }),
    doorLock: entity({ platform: 'binary_sensor', name: 'Door lock', device_class: 'lock' }),
    childLock: entity({ platform: 'binary_sensor', name: 'Child lock', device_class: 'lock' }),
    steam: entity({ platform: 'binary_sensor', name: 'Steam', icon: 'mdi:kettle-steam' }),
    energy: entity({
        platform: 'sensor',
        name: 'Energy',
        icon: 'mdi:lightning-bolt',
        device_class: 'energy',
        state_class: 'total_increasing',
        unit_of_measurement: 'Wh',
    }),
    soilLevel: enumSensor({ platform: 'sensor', name: 'Soil level', icon: 'mdi:liquid-spot', device_class: 'enum' }),
    cycles: entity({ platform: 'sensor', name: 'Cycle count', icon: 'mdi:counter' }),
    tubCleanCount: entity({
        platform: 'sensor',
        name: 'Washes since drum clean',
        icon: 'mdi:washing-machine-alert',
        entity_category: 'diagnostic',
    }),
    rinse: enumSensor({ platform: 'sensor', name: 'Rinse', icon: 'mdi:water', device_class: 'enum' }),
    wrinkleCare: entity({ platform: 'binary_sensor', name: 'Wrinkle Care', icon: 'mdi:tshirt-crew-outline' }),
    turboWash: entity({ platform: 'binary_sensor', name: 'TurboWash', icon: 'mdi:rocket-launch' }),
    preWash: entity({ platform: 'binary_sensor', name: 'Pre-wash', icon: 'mdi:water-sync' }),
    extraRinse: entity({ platform: 'binary_sensor', name: 'Extra rinse', icon: 'mdi:water-plus' }),
    dryLevel: enumSensor({ platform: 'sensor', name: 'Dry level', icon: 'mdi:water-percent', device_class: 'enum' }),
    dryingMode: entity({ platform: 'sensor', name: 'Drying mode', icon: 'mdi:tumble-dryer' }),
    delayWash: entity({ platform: 'binary_sensor', name: 'Delay Wash', icon: 'mdi:clock-plus-outline' }),
    buzzer: enumSensor({
        platform: 'sensor',
        name: 'Buzzer',
        icon: 'mdi:volume-high',
        device_class: 'enum',
        entity_category: 'diagnostic',
    }),
    dampDrySignal: entity({ platform: 'binary_sensor', name: 'Damp Dry Signal', icon: 'mdi:water-alert-outline' }),
    reduceStatic: entity({ platform: 'binary_sensor', name: 'Reduce static', icon: 'mdi:flash-off-outline' }),
    energySaver: entity({ platform: 'binary_sensor', name: 'Energy Saver', icon: 'mdi:leaf' }),
    turboSteam: entity({ platform: 'binary_sensor', name: 'Turbo Steam', icon: 'mdi:kettle-steam' }),
    ecoHybrid: enumSensor({ platform: 'sensor', name: 'Eco Hybrid', icon: 'mdi:leaf', device_class: 'enum' }),
    detergent: enumSensor({ platform: 'sensor', name: 'Detergent dose', icon: 'mdi:cup', device_class: 'enum' }),
    softener: enumSensor({ platform: 'sensor', name: 'Softener dose', icon: 'mdi:cup-outline', device_class: 'enum' }),
}
