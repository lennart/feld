// see: https://github.com/parcel-bundler/parcel/issues/1762
import 'regenerator-runtime/runtime'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const apiUrl = 'https://192.168.2.118:5000'
const progressionId = 14
const states = ['init', 'map']
const stateClasses = states.map((state) => `current-state-${state}`)
const store = {
  state: 'init',
  spots: []
}

async function fetchSpots() {
  try {
    const res = await fetch(`${apiUrl}/progressions/${progressionId}/spots`)

    const spots = await res.json()

    return spots
  } catch(err) {
    console.error(err)
  }
}

async function fetchSurroundings({ latitude, longitude }) {
  try {
    const res = await fetch(`${apiUrl}/progressions/${progressionId}/surroundings?latitude=${latitude}&longitude=${longitude}`)

    const surroundings = await res.json()

    return surroundings
  } catch(err) {
    console.error(err)
  }
}

async function updateSurroundings({latitude, longitude, spots}) {
  try {
    const surroundings = await fetchSurroundings({ latitude, longitude })

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

async function initMap() {
  let map = L.map('map', {
    center: [51.505, -0.09],
    zoom: 13
  })

  L.tileLayer("https://map.al0.de/tile/{z}/{x}/{y}.png", {
    attribution: "Open Street Map"
  }).addTo(map)

  const spots = await fetchSpots()

  const spotProto = {
    active: false
  }
  store.spots = spots.map((spot) => {
    let res = Object.create(spotProto, {
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
      }
    })

    if (spot.sound) {
      const audioNode = document.createElement('audio')
      audioNode.preload = 'none'
      audioNode.src = `${apiUrl}${spot.sound.variants[0].path}`
      audioNode.crossOrigin = "anonymous"
      audioNode.loop = spot.zone_options.loop
      audioNode.addEventListener('ended', () => console.log("ended", audioNode.src))

      const source = store.audioContext.createMediaElementSource(audioNode)
      res.source = source
      res.node = audioNode
      res.canPlay = true
    } else {
      res.canPlay = false
    }

    return res
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
    if (!e.latlng.equals(lastPosition)) {
      const icon = L.divIcon({ className: 'self-marker' })
      const selfMarker = L.featureGroup([
        L.marker(e.latlng, { icon }),
        L.circle(e.latlng, { radius: e.accuracy })
      ])

      updateSurroundings({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
        spots
      })

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
  map.locate({
    watch: true,
    setView: true,
    enableHighAccuracy: true
  })
}

function initAutoplay() {
  console.log("seting up unblocking button")
  const autoplayUnblocker = document.getElementById('autoplay-unblocker')

  autoplayUnblocker.addEventListener('click', unblockAutoplay)
}

function unblockAutoplay({ target }) {
  store.audioContext = new AudioContext()
  const autoplaySound = document.getElementById('autoplay-sound')

  let source = store.audioContext.createMediaElementSource(autoplaySound)
  source.connect(store.audioContext.destination)

  store.audioContext.resume()
  autoplaySound.play()
  store.state = 'map'
  console.log("unblocking autoplay")
  handleState(document.body)
}

async function handleState(body) {
  switch (store.state) {
    case 'init':
      body.classList.remove(...stateClasses)
      body.classList.add(`current-state-init`)
      initAutoplay()
      break
    case 'map':
      body.classList.remove(...stateClasses)
      body.classList.add(`current-state-map`)
      initMap()
      break
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  handleState(document.body)
})
