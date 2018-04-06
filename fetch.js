import axios from 'axios'
import mysql from 'async-mysql'

const events = require('events')
// Event Functions

class Fetcher {
  constructor() {
    this.eventEmitter = new events.EventEmitter()
    this.baseURL = 'https://api.playbattlegrounds.com/shards'
    this.servers = ['pc-oc', 'pc-eu', 'pc-as', 'pc-krjp', 'pc-jp', 'pc-na', 'pc-sa', 'pc-sea']
    this.serverChanged = false
    this.header = {
      'Authorization': 'Bearer ' + process.env.omnic_pubg_api_key,
      'Accept': 'application/vnd.api+json'
    }
    this.nickname = process.env.omnic_pubg_name

    this.latest_game = new Date()
    this.interrupt = false

    this.db = mysql.connect({
      host: process.env.omnic_db_host,
      port: 3306,
      user: process.env.omnic_db_user,
      password: process.env.omnic_db_password,
      database: process.env.omnic_db
    })

    this.eventEmitter.on('streamOn', this.validateGameStart)
    this.eventEmitter.on('streamDown', () => {
      this.interrupt = true
    })
    this.eventEmitter.on('cycleDone', (counter) => {
      if(this.interrupt) return
      this.retrieveDataFromServer(counter == this.servers.length ? 0 : counter+1)
    })
    this.eventEmitter.on('serverChange', (server) => { 
      if(this.servers.indexOf(server) == -1) return
      this.currentServer = server
      this.serverChanged = true
    })

    this.emit = this.eventEmitter.emit
  }

  validateGameStart(gameId) {
    return new Promise((resolve, reject) => {
      if(gameId == 403957) {
        this.retrieveDataFromServer(0)
        resolve()
      } else {
        reject(Error('Not a valid game id!'))
      }
    })
  }

  // Control Functions

  async retrieveDataFromServer(counter) {
    if(this.interrupt) return
    const server = this.currentServer ? this.currentServer : this.servers[counter]
    const playerByServer = await this.getPlayer(server)
    await this.findGameInPlayer(playerByServer, server)
    setTimeout(() => {
      this.eventEmitter.emit('cycleDone', counter)
    }, 8 * 1000)

  }
  
  async findGameInPlayer(player, server) {
    if(this.interrupt) return
    if(player.attributes.updatedAt > this.latest_game) {
      this.latest_game = await this.getGame(player['relationships']['matches'][0], server)
      const result = await this.fetchGameResult(this.latest_game)
      await this.insertData(result)
    }
  }

  // Real jobs
  async getPlayer(server) {
    const player = await axios.get(this.baseURL + '/' + server + '/players?filter[playerNames]=' + this.nickname, {
      headers: this.header
    })
    return player.data.data[0]
  }

  async getGame(matchId, server) {
    const game = await axios.get(this.baseURL + '/' + server + '/matches/' + matchId, {
      headers: this.header
    })
    return game.data
  }

  async fetchGameResult(gameData) { 
    const telemetry = await this.getTelemetryAsset(gameData)
    const returnData = {
      'rank': await this.getRank(telemetry),
      'kills': await this.getKills(telemetry),
      'type': await this.getGameType(gameData)
    }
    return returnData
  }

  async insertData(data) {
    const result = await this.db.query('SELECT `series` FROM `broadcast` WHERE `streamer_id`=?? ORDER BY `series` DESC LIMIT 1;', [this.nickname])
    const series = result[0].series
    let sql = 'insert into `score`(`series`, `rank`, `kills`, type`, `streamer_id`) value(?, ?, ?, ?, ?)'
    sql = mysql.format(sql, [series, data.rank, data.kills, data.type, this.nickname])
    await this.db.query(sql)
  }

  async getRank(telemetry) {
    try {
      const playerKilledEvent = await this.findInPUBGArray(telemetry, {'_T': 'LogPlayerKill','victim': {'name': this.nickname}})
      if(playerKilledEvent.length == 0) return 1
      const killedPlayerInfo = playerKilledEvent[0].victim
      if(killedPlayerInfo.ranking != 0) {
        return killedPlayerInfo.ranking
      } else {
        const sameTeamPlayers = await this.findInPUBGArray(telemetry, {'_T': 'LogPlayerKill','victim': {'teamId': killedPlayerInfo.teamId}})
        for(const i in sameTeamPlayers) {
          if(sameTeamPlayers[i].victim.ranking != 0) return sameTeamPlayers[i].victim.ranking
        }
        return -1
      }
    } catch(err) {
      console.error(err)
      return -1
    }
  }

  async getKills(telemetry) {
    try {
      const totalKillEvents = await this.findInPUBGArray(telemetry, {'_T': 'LogPlayerKill', 'killer': {'name': this.nickname}})
      return totalKillEvents.length
    } catch(err) {
      // console.error(err)
      return null
    }
  }

  async getGameType(data) {
    return data.data.attributes.gameMode
  }

  // Functions used in jobs 

  async getTelemetryAsset(data) { 
    try {
      const assetId = data.data.relationships.assets.data[0].id
      const telemetryUrl = await this.findInPUBGArray(data.included, {
        'type': 'asset',
        'id': assetId
      })
      const telemetryData = await axios.get(telemetryUrl[0].attributes.URL)
      return telemetryData.data
    } catch(err) {
      console.error(err)
      return null
    }
  }

  async findInPUBGArray(array, conditions) {
    return array.filter(item => this.findInPUBGObject(item, conditions))
  }

  findInPUBGObject(object, conditions) {
    let conditionKeys = Object.keys(conditions)
    for(const i in conditionKeys) {
      if(!object[conditionKeys[i]]) return false
      if(typeof object[conditionKeys[i]] != typeof conditions[conditionKeys[i]]) return false
      if(object[conditionKeys[i]] instanceof Array) {
        if(!this.findInPUBGArray([conditionKeys[i]], conditions[conditionKeys[i]])) return false
      } else if(object[conditionKeys[i]] instanceof Object) {
        if(!this.findInPUBGObject(object[conditionKeys[i]], conditions[conditionKeys[i]])) return false
      }
      else if(object[conditionKeys[i]] != conditions[conditionKeys[i]]) return false
    }
    return true
  }
}

export default Fetcher