import http from 'http'
import koa from 'koa'
import koaBody from 'koa-bodyparser'
import koaJson from 'koa-json'
import koaError from 'koa-onerror'
import koaLogger from 'koa-logger'
import koaRouter from 'koa-router'
import axios from 'axios'
import ipc from 'node-ipc'

const debug = require('debug')('http')

ipc.config.id = 'pubg-webhook'
ipc.config.retry = 1500

const app = new koa()
const router = new koaRouter()

koaError(app)

ipc.connectTo('pubg-fetcher', () => {
  ipc.of['pubg-fetcher'].on('connect', () => {
    ipc.log('## connected to pubg-fetcher ##', ipc.config.delay)
  })
  ipc.of['pubg-fetcher'].on('disconnect', () => {
    ipc.log('Disconnected from pubg-fetcher')
  })
  ipc.of['pubg-fetcher'].on('result', (data) => {
    console.log('Fetcher start result: ' + data)
  })
})

app.use(koaBody({
  enableTypes: ['json', 'form', 'text']
}))

app.use(koaJson())
app.use(koaLogger())

app.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log(`${ctx.method} ${ctx.url} - ${ms}ms`)
})



router.get('/twitch/webhook', async (ctx, next) => {
  console.log(ctx.query)
  if(ctx.query['hub.mode'] == 'subscribe') {
    ctx.response.body = ctx.query['hub.challenge']
  } else if(ctx.query['hub.mode'] == 'denied') {
    ctx.response.body = ''
  }
})

router.post('/twitch/webhook', async (ctx, next) => {
  if(ctx.request.body.data && ctx.request.body.data.length > 0) {
    console.log(ctx.request.body)
    ipc.of['pubg-fetcher'].emit('streamOn', ctx.request.body.data[0].game_id)
  } else {
    ipc.of['pubg-fetcher'].emit('streamDown')
  }
  ctx.response.body = ''
})

app.use(router.routes(), router.allowedMethods())

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error
  }
  // handle specific listen errors with friendly messages
  const bind = 'Port 3000'
  switch (error.code) {
  case 'EACCES':
    console.error(bind + ' requires elevated privileges')
    process.exit(1)
    break
  case 'EADDRINUSE':
    console.error(bind + ' is already in use')
    process.exit(1)
    break
  default:
    throw error
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  const addr = server.address()
  const bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port
  debug('Listening on ' + bind)
  setWebhook(86400)
  setInterval(() => setWebhook(86400), 86400 * 1000)
}

function setWebhook(duration) {
  let body = {
    'hub.callback': process.env.omnic_twitch_webhook_url + ':3000/twitch/webhook',
    'hub.mode': 'subscribe',
    'hub.topic': 'https://api.twitch.tv/helix/streams?user_id=',
    'hub.lease_seconds': duration
  }
  let userID
  const headers = {
    'Client-ID': process.env.omnic_twitch_client_id,
    'Content-Type': 'application/json'
  }
  axios.get('https://api.twitch.tv/helix/users?login=' + process.env.omnic_streamer_nickname, {
    headers: headers
  })
    .then(data => {
      userID = data.data.data[0].id
      body['hub.topic'] += userID
      return axios.post('https://api.twitch.tv/helix/webhooks/hub', body, {
        headers: headers
      })
    })
    .then(data => {
      console.log('Registered webhook to ' + body['hub.callback'])
      console.log(data.data)
      return axios.get('https://api.twitch.tv/helix/streams?user_id=' + userID, {
        headers: headers
      })
    })
    .then(response => {
      console.log(response.data)
      if(response.data.data.length > 0) {
        ipc.of['pubg-fetcher'].emit('streamOn', response.data.data[0].game_id)    
      } else {
        ipc.of['pubg-fetcher'].emit('streamDown')
      }
    })
}

const server = http.createServer(app.callback())
server.listen(process.env.PORT || 3000)
server.on('error', onError)
server.on('listening', onListening)

