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

    const activeSpotIds = new Set(store.spots.filter(({ active }) => active).map(({ id }) => id))
    const surroundingSpotIds = new Set(surroundings.map(({ id }) => id))

    const spotsEntered = [...surroundingSpotIds].filter((x) => !activeSpotIds.has(x)).map((id) => store.spots.find((spot) => spot.id === id))
    const spotsLeft = [...activeSpotIds].filter((x) => !surroundingSpotIds.has(x)).map((id) => store.spots.find((spot) => spot.id === id))
    
    spotsEntered.forEach((spot) => {
      spot.source.connect(store.audioContext.destination)
      spot.node.play()
      spot.active = true
    })

    spotsLeft.forEach((spot) => {
      spot.source.disconnect(store.audioContext.destination)
      spot.node.pause()
      spot.active = false
    })
    
    console.log('currently active', activeSpotIds, 'new surroundings', surroundingSpotIds, 'entered', spotsEntered, 'left', spotsLeft)
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

  store.spots = spots.filter((spot) => !!spot.sound).map((spot) => {
    const audioNode = document.createElement('audio')
    audioNode.preload = 'none'
    audioNode.src = `${apiUrl}${spot.sound.variants[0].path}`
    audioNode.crossOrigin = "anonymous"
    audioNode.addEventListener('play', () => console.log("playing", audioNode.src))
    const source = store.audioContext.createMediaElementSource(audioNode)

    return {
      id: spot.id,
      node: audioNode,
      source: source,
      active: false
    }
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
      setTimeout(() => {
        selfMarker.removeFrom(map)
      }, 10000)

      console.log("found you", e.latlng, e.accuracy)
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

