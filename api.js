class API {
  constructor({ url, progressionId }) {
    this.url = url
    this.progressionId = progressionId
    this.fetchSpots.bind(this)
    this.fetchSurroundings.bind(this)
    console.log(this.url, this.progressionId, 'API')
  }

  async fetchSpots() {
    try {
      const res = await fetch(`${this.url}/progressions/${this.progressionId}/spots`)

      return await res.json()
    } catch (err) {
      throw new Error(err.message)
    }
  }

  async fetchSurroundings({ latitude, longitude }) {
    try {
      const res = await fetch(`${this.url}/progressions/${this.progressionId}/surroundings?latitude=${latitude}&longitude=${longitude}`)

      return await res.json()
    } catch (err) {
      throw new Error(err.message)
    }
  }

}

export default API
