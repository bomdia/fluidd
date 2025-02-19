import Vue from 'vue'
import { MutationTree } from 'vuex'
import { ConfigState, UiSettings, SaveByPath, InstanceConfig, InitConfig } from './types'
import { defaultState } from './index'
import { Globals } from '@/globals'
import { merge, set } from 'lodash-es'
import { v4 as uuidv4 } from 'uuid'

export const mutations: MutationTree<ConfigState> = {
  /**
   * Reset state
   */
  setReset (state) {
    Object.assign(state, defaultState())
  },

  /**
   * Inits UI settings from the db
   */
  setInitUiSettings (state, payload: UiSettings) {
    if (payload) Vue.set(state, 'uiSettings', merge(state.uiSettings, payload))
  },

  /**
   * During init of the store, sets localConfig.
   * This would usually be set once loaded from localStorage.
   */
  setInitLocal (state) {
    if (Globals.LOCAL_CARDSTATE_STORAGE_KEY in localStorage) {
      const config = JSON.parse(localStorage[Globals.LOCAL_CARDSTATE_STORAGE_KEY])
      Vue.set(state, 'cardState', config)
    }

    if (Globals.LOCAL_CARDLAYOUT_STORAGE_KEY in localStorage) {
      const config = JSON.parse(localStorage[Globals.LOCAL_CARDLAYOUT_STORAGE_KEY])
      Vue.set(state, 'cardLayout', config)
    }
  },

  /**
   * Sets the API and Socket URLS on first load and
   * ensure the instance is configured in local storage
   */
  setInitApiConfig (state, payload) {
    // consola.log('initing apis', payload)
    state.apiUrl = payload.apiUrl
    state.socketUrl = payload.socketUrl
  },

  setInitHostConfig (state, payload) {
    state.hostConfig.blacklist = payload.blacklist
    state.hostConfig.endpoints = payload.endpoints
    state.hostConfig.hosted = payload.hosted
  },

  setInitInstances (state, payload: InitConfig) {
    let instances: InstanceConfig[] = []
    const apiConfig = payload.apiConfig
    // const uiSettings = payload.uiSettings
    const uiSettings = state.uiSettings
    if (Globals.LOCAL_INSTANCES_STORAGE_KEY in localStorage) {
      instances = JSON.parse(localStorage[Globals.LOCAL_INSTANCES_STORAGE_KEY])
    }

    const i = instances.findIndex((instance: InstanceConfig) => instance.apiUrl === payload.apiConfig.apiUrl)
    if (i === -1) {
      if (
        (uiSettings || uiSettings === null) &&
        (apiConfig && apiConfig.apiUrl !== '' && apiConfig.socketUrl !== '')
      ) {
        // Ensures we only add instances we've had a successful connection to.
        instances.forEach(instance => { instance.active = false })
        instances.push({ ...apiConfig, active: true, name: state.uiSettings.general.instanceName })
      }
    } else {
      instances.forEach((instance, index) => {
        instance.active = (index === i)
        if (index === i) {
          instance.name = state.uiSettings.general.instanceName
        }
      })
    }
    localStorage.setItem(Globals.LOCAL_INSTANCES_STORAGE_KEY, JSON.stringify(instances))
    Vue.set(state, 'instances', instances)
  },

  setUpdateInstanceName (state, payload) {
    const index = state.instances.findIndex(instance => instance.apiUrl === payload.apiUrl)
    if (index > -1) {
      const instance = state.instances[index]
      Vue.set(state.instances, index, { ...instance, ...payload })
    }
    localStorage.setItem(Globals.LOCAL_INSTANCES_STORAGE_KEY, JSON.stringify(state.instances))
  },

  setRemoveInstance (state, payload) {
    const instances = state.instances
    const i = instances.findIndex((instance: InstanceConfig) => instance.apiUrl === payload.apiUrl)
    if (i >= 0) {
      instances.splice(i, 1)
      Vue.set(state, 'instances', instances)
      localStorage.setItem(Globals.LOCAL_INSTANCES_STORAGE_KEY, JSON.stringify(instances))
    }
  },

  /**
   * This should only be used on properties that have a default state in the store
   * otherwise they will not be reactive.
   */
  setSaveByPath (state, payload: SaveByPath) {
    set(state, payload.path, payload.value)
  },

  /**
   * Update / Add a temperature preset
   */
  setPreset (state, payload) {
    if (payload.id === -1) {
      payload.id = uuidv4()
      state.uiSettings.dashboard.tempPresets.push(payload)
    } else {
      const i = state.uiSettings.dashboard.tempPresets.findIndex(preset => preset.id === payload.id)
      if (i >= 0) {
        Vue.set(state.uiSettings.dashboard.tempPresets, i, payload)
      }
    }
  },

  /**
   * Remove a preset
   */
  setRemovePreset (state, payload) {
    const i = state.uiSettings.dashboard.tempPresets.findIndex(preset => preset.id === payload.id)
    state.uiSettings.dashboard.tempPresets.splice(i, 1)
  },

  /**
   * Puts us into layout mode
   */
  setLayoutMode (state, payload) {
    state.layoutMode = payload
  }
}
