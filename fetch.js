import axios from 'axios'
import mysql from 'async-mysql'
import Twitch from 'twitch-js'
import ipc from 'node-ipc'

const baseURL = 'https://api.playbattlegrounds.com/shards'
const PUBGTwitchID = 493057
const servers = ['pc-oc', 'pc-eu', 'pc-as', 'pc-krjp', 'pc-jp', 'pc-na', 'pc-sa', 'pc-sea']
const requestHeader = {
  'Authorization': 'Bearer ' + process.env.omnic_pubg_api_key,
  'Accept': 'application/vnd.api+json'
}
const nickname = process.env.omnic_pubg_name
let db

const options = {
  options: {
    debug: true
  },
  connection: {
    reconnect: true,
    secure: true
  },
  channels: ['#' + process.env.omnic_streamer_nickname]
}

const awaitSleep = (msecs) => { 
  return new Promise((resolve) => {
    setInterval(() => resolve(), msecs)
  })
}

let currentServer = null
let latestGame = new Date()
let interrupt = true

ipc.config.id = 'pubg-fetcher'
ipc.config.retry = 1500

ipc.serve(() => {
  ipc.server.on('streamOn', (data, socket) => {
    ipc.log('stream is on!')
    if(interrupt) {
      if(data == PUBGTwitchID) {
        interrupt = false
        body()
      }
      ipc.server.emit(socket, 'result', data == PUBGTwitchID)
    }
  })
  ipc.server.on('streamDown', (data, socket) => {
    ipc.log('stream is down!')
    interrupt = true
  })
})
ipc.server.start()

const client = new Twitch.client(options)
client.on('chat', async (channel, userstate, message, self) => {
  if(process.argv.indexOf(userstate.username) == -1 && process.env.omnic_streamer_nickname != userstate.username) return
  switch(userstate['message-type']) {
  case 'chat':
    if(message.indexOf('!!forceUpdate ') == 0) {
      try {
        console.log(`Force inserting game #${message.replace('!!forceUpdate ', '').trim()}`)
        const game = await getGame(message.replace('!!forceUpdate ', '').trim())
        const result = await fetchGameResult(game)
        await insertData(result)
        latestGame = new Date(game.data.attributes.createdAt)
      } catch(e) {
        console.log(e)
      }
    } else if(message.indexOf('!!setServer ') == 0) {
      if(servers.indexOf(message.replace('!!setServer ', '').trim()) >= 0) {
        currentServer = message.replace('!!setServer ', '').trim()
        client.say('#' + channel, `Server set to ${currentServer}`)
      } else {
        currentServer = null
        client.say('#' + channel, `Server ${message.replace('!!setServer ', '').trim()} not recognized! Falling back to default mode...`)
      }
    }
  }
})
client.connect()
  .then(() => {
    console.log('TMI now listening')
  })

// Control Functions

async function body() {
  console.log('Starting fetcher job...')
  db = await mysql.connect({
    host: process.env.omnic_db_host,
    port: 3306,
    user: process.env.omnic_db_user,
    password: process.env.omnic_db_password,
    database: process.env.omnic_db
  })
  let counter = 0
  let playerByServer
  let updatedGame = null
  while(true) {
    console.log(`interrupt: ${interrupt}`)
    if(interrupt) break
    const server = currentServer ? currentServer : servers[counter]
    try {
      playerByServer = await getPlayer(server)
      updatedGame = await isUpdated(playerByServer, server, latestGame)
      if(updatedGame != null) { 
        const result = await fetchGameResult(updatedGame)
        await insertData(result)
        latestGame = new Date(updatedGame.data.attributes.createdAt)
      }
    } catch(e) {
      if(!e.response) {
        console.log(e)
      } else {
        console.log(e.response.status)
        console.log(e.response.headers)
        if(e.response.status == 429) {
          const timeToSleep = parseInt(e.reponse.headers['x-ratelimit-reset']) - new Date().getTime()
          console.log(`met 429! sleeping ${timeToSleep} milliseconds`)
          await awaitSleep(timeToSleep)
        }
      }
    } finally {
      console.log('Sleeping 7 secs to avoid api limit')
      await awaitSleep(1000 * 7)
      if(updatedGame != null) {
        console.log('PlayerbyServer:')
        console.log(playerByServer)
      }
      if(counter == servers.length-1) counter = 0; else counter += 1
    }
  }
  console.log('Fetcher off')
}


// Real jobs
async function getPlayer(server) {
  console.log(`fetching from ${server}`)
  try {
    const player = await axios.get(baseURL + '/' + server + '/players?filter[playerNames]=' + nickname, {
      headers: requestHeader
    })
    return player.data.data[0]
  } catch(e) {
    throw e
  }
}

async function getGame(gameId, server) {
  try {
    const game = await axios.get(baseURL + '/' + server + '/matches/' + gameId, {
      headers: requestHeader
    })
    return game.data
  } catch(e) {
    throw e
  }
}

async function isUpdated(player, server, date) {
  if(player.relationships.matches.data.length == 0) return null
  try {
    const game = await getGame(player.relationships.matches.data[0].id, server)
    console.log(`Latest game at ${game.data.attributes.createdAt}, last update date is ${date}`)
    if(new Date(game.data.attributes.createdAt) > date)
      return game 
    else
      return null
  } catch(e) {
    throw e
  }
}

async function fetchGameResult(gameData) { 
  const telemetry = await getTelemetryAsset(gameData)
  const returnData = {
    'rank': await getRank(telemetry),
    'kills': await getKills(telemetry),
    'type': await getGameType(gameData)
  }
  return returnData
}

async function insertData(data) {
  const query = 'SELECT `series` FROM `broadcast` WHERE streamer_id=\'' + process.env.omnic_streamer_nickname + '\' ORDER BY `series` DESC LIMIT 1;'
  console.log(query)
  const result = await db.query(query)
  console.log(result)
  const series = result[0].series
  let sql = `insert into \`score\`(\`series\`, \`rank\`, \`kill\`, \`type\`, \`streamer_id\`) value('${series}', '${data.rank}', '${data.kills}', '${data.type}', '${process.env.omnic_streamer_nickname}')`
  await db.query(sql)
}

async function getRank(telemetry) {
  try {
    const playerKilledEvent = await findInPUBGArray(telemetry, {'_T': 'LogPlayerKill','victim': {'name': nickname}})
    if(playerKilledEvent.length == 0) return 1
    const killedPlayerInfo = playerKilledEvent[0].victim
    if(killedPlayerInfo.ranking != 0) {
      return killedPlayerInfo.ranking
    } else {
      const sameTeamPlayers = await findInPUBGArray(telemetry, {'_T': 'LogPlayerKill','victim': {'teamId': killedPlayerInfo.teamId}})
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

async function getKills(telemetry) {
  try {
    const totalKillEvents = await findInPUBGArray(telemetry, {'_T': 'LogPlayerKill', 'killer': {'name': nickname}})
    return totalKillEvents.length
  } catch(err) {
    // console.error(err)
    return null
  }
}

async function getGameType(data) {
  return data.data.attributes.gameMode
}

// Functions used in jobs 

async function getTelemetryAsset(data) { 
  try {
    const assetId = data.data.relationships.assets.data[0].id
    const telemetryUrl = await findInPUBGArray(data.included, {
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

async function findInPUBGArray(array, conditions) {
  return array.filter(item => findInPUBGObject(item, conditions))
}

function findInPUBGObject(object, conditions) {
  let conditionKeys = Object.keys(conditions)
  for(const i in conditionKeys) {
    if(!object[conditionKeys[i]]) return false
    if(typeof object[conditionKeys[i]] != typeof conditions[conditionKeys[i]]) return false
    if(object[conditionKeys[i]] instanceof Array) {
      if(!findInPUBGArray([conditionKeys[i]], conditions[conditionKeys[i]])) return false
    } else if(object[conditionKeys[i]] instanceof Object) {
      if(!findInPUBGObject(object[conditionKeys[i]], conditions[conditionKeys[i]])) return false
    }
    else if(object[conditionKeys[i]] != conditions[conditionKeys[i]]) return false
  }
  return true
}
