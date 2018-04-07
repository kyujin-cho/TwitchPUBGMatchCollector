import http from 'http'
import koa from 'koa'
import koaBody from 'koa-bodyparser'
import koaJson from 'koa-json'
import koaError from 'koa-onerror'
import koaLogger from 'koa-logger'
import koaRouter from 'koa-router'
import debug from 'debug'
import axios from 'axios'
import Twitch from 'twitch-js'
import fetcher from './fetch'

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

const app = new koa()
const router = new koaRouter()
koaError(app)

const client = new Twitch.client(options)

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


client.on('chat', (channel, userstate, message, self) => {
  if(self || userstate['name'] != process.env.omnic_streamer_nickname) return
  if(message.trim().indexOf('!!setServer ') != 0) {
    fetcher.emit('serverChange', message.trim().replace('!!setServer ').split(' ')[0])
  }
})

router.get('/twitch/webhook', async (ctx, next) => {
  if(ctx.params['hub.mode'] == 'subscribe') {
    ctx.body = ctx.params['hub.challenge']
  } else if(ctx.params['hub.mode'] == 'denied') {
    ctx.body = ''
  }
})

router.post('/twitch/webhook', async (ctx, next) => {
  if(ctx.body.data) {
    fetcher.emit('streamOn', ctx.body.data[0].game_id)
  } else {
    fetcher.emit('streamDown')
  }
  ctx.body = ''
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
  setInterval(() => setWebhook(86400), 86400)
}

function setWebhook(duration) {
  let body = {
    'hub.callback': process.env.omnic_twitch_webhook_url + '/twitch/webhook',
    'hub.mode': 'subscribe',
    'hub.topic': 'https://api.twitch.tv/helix/streams?user_id=',
    'hub.lease_seconds': duration
  }
  const headers = {
    'Client-ID': process.env.omnic_twitch_client_id,
    'Content-Type': 'application/json'
  }
  axios.get('https://api.twitch.tv/helix/users?login=' + process.env.omnic_streamer_nickname, {
    headers: headers
  })
    .then(data => {
      const userID = data.data.data[0].id
      body['hub.topic'] += userID
      return axios.post('https://api.twitch.tv/helix/webhooks/hub', body, {
        headers: headers
      })
    })
    .then(data => {
      console.log('Registered webhook')
    })
}

const server = http.createServer(app.callback())
server.listen(process.env.PORT || 3000)
server.on('error', onError)
server.on('listening', onListening)

