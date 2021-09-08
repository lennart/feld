// see: https://github.com/parcel-bundler/parcel/issues/1762
import 'regenerator-runtime/runtime'
import L from 'leaflet'
import { AudioContext } from 'standardized-audio-context'
import './index.css'
import 'leaflet/dist/leaflet.css'

import './silence.mp3'
import instructionsHTML from './instructions.html'
import instructionsHTMLEnglish from './instructions.en.html'
import API from './api'

var _paq = window._paq = window._paq || [];
let locationFound = false

window.onerror = function globalErrorHandler(msg, url, line, column, error) {
  _paq.push(['trackEvent', 'Error', `${url}:${line}:${column} ${msg}`, error.stack])
  console.error(error)
  return false
}

window.onunhandledrejection = function globalUnhandledRejectionHandler(error) {
  _paq.push(['trackEvent', 'UnhandledRejection', error.reason || 'unknown'])
  console.error(error)
}

function trackMatomoEvent(action, name) {
  _paq.push(['trackEvent', 'Play Mode', action, name]);
}

async function updateSurroundings(store) {
  const { latitude, longitude } = store
  try {
    const surroundings = await store.api.fetchSurroundings({ latitude, longitude })

    console.log(surroundings)

    const activeSpots = store.spots.filter(({ active }) => active)
    const activeSpotIds = new Set(activeSpots.map(({ id }) => id))
    const surroundingSpotIds = new Set(surroundings.map(({ id }) => id))

    const spotsEntered = [...surroundingSpotIds].filter((x) => !activeSpotIds.has(x)).map((id) => store.spots.find((spot) => spot.id === id))
    const spotsLeft = [...activeSpotIds].filter((x) => !surroundingSpotIds.has(x)).map((id) => store.spots.find((spot) => spot.id === id))

    if (spotsEntered.find(({ globalStop }) => globalStop)) {
      store.spots.filter(({ playing }) => playing).forEach((spot) => {
        if (spot.canPlay) {
          spot.node.pause()
          spot.node.load() // to rewind
        }
        // TODO: make it clear how a global stop affects running audio nodes
        // either
        // 1. we set these spots to inactive and therefore leaving the global stop zone will play all sounds of zones you are currently in
        // 2. we just stop sounds from the spots but leave them acitve, leaving the global stop zone will just do nothing (except from possibly stopping the sound attached to the global-stop zone itself)
        // spot.active = false
      })
    }

    spotsEntered.forEach((spot) => {
      if (spot.canPlay) {
        spot.source.connect(store.audioContext.destination)
        spot.node.play()
      }
      spot.active = true
    })

    spotsLeft.forEach((spot) => {
      if (spot.canPlay) {
        if (spot.oneShot) {
          spot.node.addEventListener('ended', () => {
            console.log(spot.id, 'ended')
          })
        } else {
          spot.node.pause()
          spot.node.load() // to rewind
        }
      }
      spot.active = false
    })

    console.log('entered',
                JSON.stringify(
                  spotsEntered.map(({ id, globalStop, oneShot, loop, canPlay, duration }) => {
                    return `${id} - cp:${canPlay} gs:${globalStop} os:${oneShot} lo:${loop}`
                  })
    ))
    console.log('left', spotsLeft.map(({id}) => id))
  } catch(err) {
    console.error(err)
  }
}

function initAudioNodes(store, body) {
  store.spots = store.spots.map((spot) => {
    if (spot.sound) {
      const audioNode = document.createElement('audio')
      audioNode.preload = 'none'
      audioNode.src = `${store.rootUrl}${spot.sound.variants[0].path}`
      audioNode.crossOrigin = "anonymous"
      audioNode.loop = spot.loop
      audioNode.addEventListener('ended', () => console.log("ended", audioNode.src))

      const source = store.audioContext.createMediaElementSource(audioNode)
      spot.source = source
      spot.node = audioNode
      spot.canPlay = true
    } else {
      spot.canPlay = false
    }
    return spot
  })
  if (store.locationFound) {
    updateSurroundings(store)
  }
}

async function initMap(store, body) {
  const mapElement = document.createElement('div')
  mapElement.id = 'map'
  body.appendChild(mapElement)
  let map = L.map(mapElement, {
    center: [51.505, -0.09],
    zoom: 13
  })

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map)

  const spots = await store.api.fetchSpots()

  const spotProto = {
    active: false
  }
  store.spots = spots.map((spot) => {
    return Object.create(spotProto, {
      id: {
        get() { return spot.id }
      },
      globalStop: {
        get() { return !!spot.zone_options.global_stop }
      },
      oneShot: {
        get() { return !!spot.zone_options.one_shot }
      },
      loop: {
        get() { return !!spot.zone_options.loop }
      },
      playing: {
        get() {
          return this.node && !this.node.paused
        }
      },
      sound: {
        get() {
          return spot.sound
        }
      }
    })
  })

  const spotCircles = spots.map(({ location: { latitude, longitude }, radius }) => {
    return L.circle([latitude, longitude], {
      radius,
      color: "green",
      fillColor: "green",
      fillOpacity: 0.3
    })
  })

  const spotFeatureGroup = L.featureGroup(spotCircles)

  spotFeatureGroup.addTo(map)
  map.fitBounds(spotFeatureGroup.getBounds())
  let lastPosition = L.latLng(0,0)

  let lastMarker
  map.on('locationfound', (e) => {
    if (!locationFound) {
      locationFound = true
      store.locationFound = true
      trackMatomoEvent('Location Found', `precision: ${e.accuracy}m`)
    }

    if (!e.latlng.equals(lastPosition)) {
      const icon = L.divIcon({ className: 'self-marker' })
      const selfMarker = L.featureGroup([
        L.marker(e.latlng, { icon }),
        L.circle(e.latlng, { radius: e.accuracy })
      ])

      store.latitude = e.latlng.lat
      store.longitude = e.latlng.lng

      if (store.audioContext) {
        updateSurroundings(store)
      }

      selfMarker.addTo(map)
      if (lastMarker) {
        let fadingMarker = lastMarker
        setTimeout(() => {
          fadingMarker.removeFrom(map)
        }, 10000)
      }
      lastMarker = selfMarker


      console.log("you are somewhere", e.accuracy, "meters around", e.latlng)
      lastPosition = e.latlng
    }
  })

  L.Control.FELD_Help = L.Control.extend({
    onAdd: function(map) {
      this.btn = L.DomUtil.create('button')
      this.btn.classList.add('btn-help')
      this.btn.textContent = "?"

      L.DomEvent.on(this.btn, 'click', showHelp, { store, body })

      return this.btn
    },
    onRemove: function(map) {
      L.DomEvent.off(this.btn, 'click', showHelp, { store, body })
    }
  })

  L.control.feld_help = function(opts) {
    return new L.Control.FELD_Help(opts)
  }

  L.control.feld_help({ position: 'topright' }).addTo(map)

  store.map = map
  if (!store.audioContext) {
    await initAutoplay(store, body)

    map.locate({
      watch: true,
      enableHighAccuracy: true
    })
    initAudioNodes(store, body)
  }
}

async function initAutoplay(store, body) {
  const overlay = document.createElement('div')
  overlay.classList.add('feld-map-overlay')
  const autoplayUnblocker = document.createElement('button')
  autoplayUnblocker.classList.add('btn-white')
  autoplayUnblocker.textContent = 'Play'

  const autoplayUnblocked = new Promise((resolve) => {
    const unblockAutoplay = function unblockAutoplay({ target }) {
      trackMatomoEvent('Start', 'FELD_')
      store.audioContext = new AudioContext()
      const autoplaySound = new Audio()

      body.appendChild(autoplaySound)
      let source = store.audioContext.createMediaElementSource(autoplaySound)
      source.connect(store.audioContext.destination)

      store.audioContext.resume()
      autoplaySound.play()
      store.state = 'map'
      console.log("unblocking autoplay")
      overlay.remove()
      resolve()
    }
    autoplayUnblocker.addEventListener('click', unblockAutoplay)
    overlay.appendChild(autoplayUnblocker)
    body.appendChild(overlay)
  })

  return autoplayUnblocked
}

function showHelp() {
  const overlay = document.createElement('div')
  overlay.classList.add('feld-map-overlay')
  overlay.classList.add('align-items-start')
  const instructionSection = document.createElement('section')
  instructionSection.classList.add('overflow-x-scroll')

  instructionSection.innerHTML = this.store.languageCode === 'en' ? instructionsHTMLEnglish : instructionsHTML
  const closeButtons = instructionSection.querySelectorAll('button')

  const closeHelp = function closeHelp({ target }) {
    overlay.remove()
  }

  for (const btn of closeButtons) {
    btn.addEventListener('click', closeHelp)
  }
  overlay.appendChild(instructionSection)
  this.body.appendChild(overlay)
}

const isReady = new Promise((resolve) => {
  document.addEventListener("DOMContentLoaded", async () => {
    resolve()
  })
})

const storeProto = {
  state: 'map',
  spots: []
}

async function feld({ rootUrl, progressionId, languageCode }) {
  console.log('feld init', rootUrl, progressionId)
  const states = ['init', 'map']
  const api = new API({
    url: `${rootUrl}/api`,
    progressionId
  })
  const store = Object.create(storeProto, {
    rootUrl: {
      get() { return rootUrl }
    },
    api: {
      get() { return api }
    },
    stateClasses: {
      get() { return states.map((state) => `current-state-${state}`) }
    },
    languageCode: {
      get() {
        return languageCode
      }
    }
  })

  await isReady
  const body = document.body
  body.classList.remove(...store.stateClasses)
  body.classList.add(`current-state-map`)
  initMap(store, body)
}

window.feld = feld
