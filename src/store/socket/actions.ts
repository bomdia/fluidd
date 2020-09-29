import Vue from 'vue'
import { ActionTree } from 'vuex'
import { SocketState, ChartItem } from './types'
import { RootState } from '../types'
import { configureChartEntry } from '../helpers'
import { Globals } from '@/globals'
import { SocketActions } from '@/socketActions'

export const actions: ActionTree<SocketState, RootState> = {
  /**
   * ==========================================================================
   *  Specific requests via socket
   * ==========================================================================
   */

  /**
    * Fired when the socket first opens.
    */
  async onSocketOpen ({ commit }, payload) {
    commit('onSocketOpen', payload)
    SocketActions.printerInfo()
  },

  /**
   * Fired when the socket first closes.
   */
  async onSocketClose ({ commit }, payload) {
    commit('onSocketClose', payload)
  },

  /**
   * Fired when the socket encounters an error.
   * We might see an error under code 400 for invalid circumstances, like
   * trying to extrude under temp. Should present the user with an error
   * for these cases.
   * Another case might be during a klippy disconnect.
   */
  async onSocketError ({ commit }, payload) {
    if (payload.code === 400) {
      // clear any associated waits.
      if (payload.__request__ && payload.__request__.wait) {
        commit('removeWait', payload.__request__.wait)
      }
      console.debug('throw an error to the user', payload.message)
    }
    if (payload.code === 503) {
      //  && payload.message.toLowerCase() === 'klippy host not connected'
      // This indicates klippy is non-responsive, or there's a configuration error
      // in klipper. We should retry after the set delay.
      // Restart our startup sequence.
      commit('resetState')
      commit('onPrinterInfo', { state: 'error', message: payload.message }) // Forcefully set the printer in error
      setTimeout(() => {
        SocketActions.printerInfo()
      }, Globals.KLIPPY_RETRY_DELAY)
    }
  },

  /**
   * Print cancelled confirmation.
   */
  async onPrintCancel ({ commit }, payload) {
    console.log('Print Cancelled')
  },

  /**
   * Print paused confirmation.
   */
  async onPrintPause ({ commit }, payload) {
    console.log('Print Paused')
  },

  async onPrintResume ({ commit }, payload) {
    console.log('Print Resumed')
  },

  async onPrinterInfo ({ commit }, payload) {
    commit('onPrinterInfo', payload)

    if (payload.state !== 'ready') {
      setTimeout(() => {
        SocketActions.printerInfo()
      }, Globals.KLIPPY_RETRY_DELAY)
    } else {
      // We're good, move on. Start by loading the temperature history.
      SocketActions.serverTemperatureStore()
    }

    // Vue.prototype.$socket.sendObj('server.files.get_directory', { path: 'gcodes' }, 'getDirectory');
    // Vue.prototype.$socket.sendObj('server.files.get_directory', { path: 'config' }, 'getDirectory');
    // Vue.prototype.$socket.sendObj('server.files.get_directory', { path: 'config_examples' }, 'getDirectory');
    // Vue.prototype.$socket.sendObj('server.files.get_directory', { path: '/gcodes' }, 'getDirectoryRoot') // file info
    // Vue.prototype.$socket.sendObj('machine.gpio_power.devices', {}, 'getPowerDevices'); // power plugin
  },

  /**
   * Once a gcode script has run, the
   * socket notifies us of the result of
   * the specific request here.
   */
  async onGcodeScript ({ commit, dispatch }, payload) {
    // If the response is ok, pass it to the console.
    if (payload && payload.result && payload.result === 'ok') {
      dispatch('addConsoleEntry', 'Recv: Ok')
    }
    // Remove a wait if defined.
    if (payload.__request__ && payload.__request__.wait && payload.__request__.wait.length) {
      commit('removeWait', payload.__request__.wait)
    }
  },

  /**
   * Stores the printers object list.
   */
  async onPrinterObjectsList ({ commit, dispatch }, payload) {
    // Given our object list, subscribe to any data we'd want constant updates for
    // and prepopulate our store.
    let intendedSubscriptions = {}
    payload.objects.forEach((k: string) => {
      if (!k.includes('menu') && !k.includes('gcode_macro')) {
        intendedSubscriptions = { ...intendedSubscriptions, [k]: null }
      }
      let key = k
      if (k.includes(' ')) key = key.replace(' ', '.')
      if (k.includes('gcode_macro')) {
        dispatch('addMacro', k.split(' ')[1])
      } else {
        commit('onPrinterObjectsList', key)
      }
    })
    SocketActions.printerObjectsSubscribe(intendedSubscriptions)
  },

  /**
   * Loads stored server data for the past 20 minutes.
   */
  async onTemperatureStore ({ commit }, payload) {
    const now = new Date() // Set a base time to work out the temp data from.
    // On a fresh boot of the host system, moonraker should give us enough data;
    // however, it seems sometimes it does not. So - we should pad this out when
    // we need to.
    // Otherwise, for a system that has been running for a bit - we should expect
    // enough data from moonraker to start with.

    // how many datasets to add. Moonraker should give us 20 minutes, in 1 second intervals.. but we only need 10 minutes.
    const count = 600 // The size of the dataset we need.
    const moonrakerCount = 1200 // The size of the dataset we expect moonraker to provide.

    for (const originalKey in payload) { // each heater / temp fan
      // If the dataset is less than 1200, then pad the beginning
      // until we get to our intended count
      const l = payload[originalKey].temperatures.length
      if (l < moonrakerCount) {
        const pad = moonrakerCount - l
        const lastTemp = payload[originalKey].temperatures[0]
        payload[originalKey].temperatures = [...Array.from({ length: pad }, () => lastTemp), ...payload[originalKey].temperatures]
        payload[originalKey].targets = [...Array.from({ length: pad }, () => 0), ...payload[originalKey].targets]
      }

      const val = payload[originalKey]
      let key = originalKey
      if (originalKey.includes(' ')) {
        key = key.split(' ')[1]
      }
      const data: ChartItem[] = [
        { label: key, data: [], radius: 0 },
        { label: `${key}Target`, data: [], radius: 0 }
      ]
      for (let i = count; i < val.temperatures.length - 1; i++) {
        // 1000 * (1200 - 1199) - 1000
        const date = new Date(now.getTime() - (1000 * (val.temperatures.length - i)) - 1000)
        data[0].data.push({
          x: date,
          y: val.temperatures[i]
        })
        data[1].data.push({
          x: date,
          y: val.targets[i]
        })
      }
      commit('addInitialChartData', data)
    }

    // After we've loaded the initial temp data, load and subscribe to the rest.
    SocketActions.printerObjectsList()
  },

  async onPrinterObjectsSubscribe ({ commit, dispatch }, payload) {
    // This initial subscribe also gives us all of our temperature fans, probes etc..
    // so we can populate a list of these things, without having to re-iterate the
    // whole printer object later.
    const keys = ['temperature_fan', 'temperature_probe', 'temperature_sensor', 'heater_fan']
    const r: {[key: string]: string[]} = {}

    Object.keys(payload.status).forEach((p) => {
      const key = p.split(' ')
      if (
        p.includes(' ') &&
        keys.includes(key[0])
      ) {
        const rootKey = key[0] + 's'
        if (rootKey in r === false) {
          r[rootKey] = [key[1]]
        } else {
          r[rootKey].push(key[1])
        }
      }
    })
    commit('setFansProbes', r)
    dispatch('notifyStatusUpdate', payload.status)
  },

  async onServerFilesMetadata ({ commit }, payload) {
    commit('onSocketNotify', { key: 'current_file', payload })
  },

  /**
   * ==========================================================================
   * Automated notifications via socket
   * Note that klipper will send an update every 250ms, if the data changed.
   * This applies per object subscribed.
   * ==========================================================================
   */

  /** Automated notify events via socket */
  async notifyStatusUpdate ({ state, commit }, payload) {
    // TODO: Maybe we need to debounce / throttle these notifications.
    // Should start by debouncing by default, and have an exception list
    // for things we don't want to miss, like target temp changes etc.

    if (payload) {
      for (const key in payload) {
        const val = payload[key]
        // Skip anything we need here.
        // gcode_macro's have already been added during the object subscribe
        // so we can safely ignore them here.
        if (
          !key.includes('gcode_macro')
        ) {
          // First, commit the value.
          commit('onSocketNotify', { key, payload: val })

          // Now pick out certain updates if required...

          // If this is a sensor update, record it for graphing.
          // A list of key strings to check for.
          let keys = [
            'temperature_fan',
            'temperature_probe'
          ]
          if (state.printer.heaters.available_heaters.length > 0) {
            keys = [...keys, ...state.printer.heaters.available_heaters]
          }
          if (
            keys.some(e => key.startsWith(e)) && // Found a node with a possible temp val...
            ('temperature' in val || 'target' in val) // Ensures the node has a temp or target val...
          ) {
            const r = configureChartEntry(key, val, state)
            // if (key.includes('chamber')) {
            //   console.log('got chamber update', key, val, r)
            // }
            commit('addChartValue', r.temperature)
            commit('addChartValue', r.target)
          }
        }
      }
    }
  },

  /**
   * Any gcode related responses are notified to us here,
   * irrelevant on if this was a specific request or not.
   */
  async notifyGcodeResponse ({ dispatch }, payload) {
    // stream gcode responses to our console data, ensuring
    // we truncate to max line count.
    dispatch('addConsoleEntry', `Recv: ${payload}`)
  },
  async notifyKlippyDisconnected ({ commit }) {
    commit('resetState')
    commit('onPrinterInfo', { state: 'error' }) // Forcefully set the printer in error
  },
  async notifyFilelistChanged ({ dispatch }, payload) {
    dispatch('files/notify' + Vue.$filters.capitalize(payload.action), payload, { root: true }) // Passed on to the files module
  },
  async notifyMetadataUpdate ({ commit, state }, payload) {
    console.log('metadataUpdate', payload)
  },

  /**
   * ==========================================================================
   *  Non specific socket requests
   * ==========================================================================
   */

  /** Not socket related */
  async addWait ({ commit }, wait) {
    commit('addWait', wait)
  },
  async removeWait ({ commit }, wait) {
    commit('removeWait', wait)
  },
  async addConsoleEntry ({ commit, state }, payload) {
    if (state.console.length >= Globals.CONSOLE_HISTORY_RETENTION) {
      commit('removeConsoleFirstEntry')
    }
    commit('addConsoleEntry', payload.replace(/(?:\r\n|\r|\n)/g, '<br>'))
  },
  async addMacro ({ commit, state, rootState }, macro) {
    // Macros should include a property to indicate if they're visible
    // on the dashboard or not. This comes from the fileConfig.
    const hidden = rootState.config?.fileConfig?.dashboard?.hiddenMacros.includes(macro)
    commit('addMacro', { name: macro, visible: !hidden })
  },
  async updateMacro ({ commit }, macro) {
    commit('updateMacro', macro)
  }
}
