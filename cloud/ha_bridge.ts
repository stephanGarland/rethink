import { type Connection } from './homeassistant'
import HADevice from './devices/base'
import { AnyDevice } from './devmgr'
import { findDriver } from './registry'

// Drivers register themselves: see cloud/registry.ts

class Bridge {
    haDevices = new Map<string, HADevice>()
    constructor(readonly HA: Connection) {
        HA.on('discovery', () => {
            this.haDevices.forEach((ha) => ha.publishConfig())
        })
        HA.on('setProperty', (id: string, prop: string, value: string) => {
            const ha = this.haDevices.get(id)
            if (ha) ha.setProperty(prop, value)
        })
    }

    newDevice(thinqdev: AnyDevice) {
        const meta = thinqdev.meta
        const oldDevice = this.haDevices.get(thinqdev.id)
        if (oldDevice) oldDevice.drop()

        let hadevice: HADevice | undefined

        if (thinqdev.platform === 'thinq1') {
            const devclass = findDriver('thinq1', meta.modelId)
            if (devclass) hadevice = new devclass(this.HA, thinqdev, meta)
        } else if (thinqdev.platform === 'thinq2') {
            const devclass = findDriver('thinq2', meta.modelId)
            if (devclass) hadevice = new devclass(this.HA, thinqdev, meta)
        }

        if (!hadevice) {
            console.warn(`${thinqdev.platform} device type ${meta.modelId} unknown`)
            return
        }

        this.haDevices.set(thinqdev.id, hadevice)

        // NOTE: we don't unset this when dropping the device, we assume that the device will never be used
        // outside of the bridge or outlive it.
        thinqdev.managed = true
        thinqdev.on('close', () => this.dropDevice(hadevice))

        // hadevice.publishConfig() not needed anymore, will usually happen in the devclass constructor - or later
        hadevice.start()
    }

    dropDevice(ha: HADevice) {
        if (this.haDevices.get(ha.id) === ha) {
            this.haDevices.delete(ha.id)
            ha.drop()
        }
    }
}

export default Bridge
