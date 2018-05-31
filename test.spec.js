const assert = require('assert')
const axios = require('axios')
const Fetcher = require('./fetch').default
const fs = require('fs')
const mysql = require('mysql')

let fetcher = new Fetcher()

describe('Authentication information test', function() {
  describe('Should have all authentication informations in environment variable', function() {
    ['pubg_api_key', 'twitch_webhook_url', 'twitch_client_id', 'pubg_name', 'streamer_nickname', 'db_host', 'db_user', 'db_password', 'db'].forEach(item => {
      it('Should have omnic_' + item + ' in env var', function() {
        assert.notEqual(process.env['omnic_' + item], undefined)
      })
    }) 
  })
  it('Should authorize successfully to PUBG API with given key', function(done) {
    axios.get('https://api.playbattlegrounds.com/shards/pc-krjp/players/he-should-not-exist', {
      headers: {
        'Accept': 'application/vnd.api+json',
        'Authorization': 'Bearer ' + process.env.omnic_pubg_api_key
      }
    })
      .catch(err => {
        assert.equal(err.response.status, 404)
        done()
      })
  })
  it('Should connect to database successfully with given informations', function(done) { 
    this.timeout(10000)
    const db = mysql.createConnection({
      host: process.env.omnic_db_host,
      port: 3306,
      user: process.env.omnic_db_user,
      password: process.env.omnic_db_password,
      database: process.env.omnic_db
    })
    db.connect(function(err) { 
      if(err) done(err)
      done()
    })
  })
})

describe('Real game data fetch test', function() {
  it('Should not start fetching if invalid game id has provided', function(done) {
    fetcher.validateGameStart(12345)
      .then(() => {
        done(new Error('Expected fetching process not started'))
      })
      .catch(err => {
        done()
      })
  })
  describe('Job functions test', function() {
    let datas 
    before(function() { 
      datas = {
        player: JSON.parse(fs.readFileSync('test/data/players/pc-oc_Funzinnu')),
        match: JSON.parse(fs.readFileSync('test/data/matches/438031fe-6ff9-4b6a-b0ea-37eb4eac5ae5')),
        telemetry: [
          JSON.parse(fs.readFileSync('test/data/telemetry/5f9d30e9-3748-11e8-9224-0a586467580b')),
          JSON.parse(fs.readFileSync('test/data/telemetry/e59b54b1-35c6-11e8-acca-0a5864631f81')),
          JSON.parse(fs.readFileSync('test/data/telemetry/5f9d30e9-3748-11e8-9224-0a586467581d')) 
        ]
      }
    })
    it('Should fetch player info from PUBG API', function(done) {
      this.timeout(5000)
      fetcher.getPlayer('pc-as')
        .then(player => {
          assert.equal(process.env.omnic_pubg_name, player.attributes.name)
          done()
        }).catch(err => done(err))
    })
    it('Should fetch valid telemetry data from game data', function(done) { 
      this.timeout(10000)
      fetcher.getTelemetryAsset(datas.match)
        .then(data => {
          assert.equal('match.bro.official.2018-04.krjp.squad.2018.04.01.438031fe-6ff9-4b6a-b0ea-37eb4eac5ae5', data[0].MatchId)
          done()
        })
        .catch(err => done(err))
    })
    describe('Should fetch valid data from telemetry', function() {
      describe('Rank test', function() {
        this.timeout(5000)
        it('Test #1', function(done) {
          fetcher.getRank(datas.telemetry[0])
            .then(rank => {
              assert.equal(16, rank)
              done()
            })
            .catch(err => done(err))
        })
        it('Test #2', function(done) {
          fetcher.getRank(datas.telemetry[1])
            .then(rank => {
              assert.equal(1, rank)
              done()
            })
            .catch(err => done(err))
        })
        it('Test #3', function(done) {
          fetcher.getRank(datas.telemetry[2])
            .then(rank => {
              assert.equal(16, rank)
              done()
            })
            .catch(err => done(err))
        })
      })
      describe('Kills test', function() {
        this.timeout(5000)
        it('Test #1', function(done) {
          fetcher.getKills(datas.telemetry[0])
            .then(kills => {
              assert.equal(3, kills)
              done()
            })
            .catch(err => done(err))
        })
        it('Test #2', function(done) {
          fetcher.getKills(datas.telemetry[1])
            .then(kills => {
              assert.equal(0, kills)
              done()
            })
            .catch(err => done(err))
        })
        it('Test #3', function(done) {
          fetcher.getKills(datas.telemetry[2])
            .then(kills => {
              assert.equal(3, kills)
              done()
            })
            .catch(err => done(err))
        })
      })
    })
    it('Should fetch valid game type from game data', function(done) {
      fetcher.getGameType(datas.match)
        .then(type => {
          assert.equal('squad', type)
          done()
        })
        .catch(err => done(err))
    })
    it('Should fetch valid game result from game data', function(done) {
      fetcher.fetchGameResult(datas.match)
        .then(data => {
          assert.equal(data.rank, 1)
          assert.equal(data.kills, 0)
          assert.equal(data.type, 'squad')
          done()
        })
        .catch(err => done(err))
    })
    describe('Should find appropriate results by given search conditions from given data', function() {
      const array_find_data = [
        {
          'foo': 'bar',
          'some': '1',
          'other': '$',
          'bool': true,
          'number': 123,
          'obj': {
            'foo': 'bar',
            'ho': 'hi'
          }
        },
        {
          'foo': 'asd',
          'some': '1',
          'other': '$',
          'bool': true,
          'number': 12,
          'obj': {
            'foo': 1234,
            'ho': 'hp'
          }
        },
        {
          'foo': 'bar',
          'some': '3',
          'other': '#',
          'bool': true,
          'number': 12,
          'obj': {
            'foo': '$$',
            'ho': 'qwe'
          }
        },
        {
          'foo': 'efd',
          'some': '4',
          'other': '$',
          'bool': false,
          'number': 456,
          'obj': {
            'foo': 'last',
            'ho': 1234
          }
        }
      ]
      it('Test #1', function(done) {
        fetcher.findInPUBGArray(array_find_data, {
          other: '#'
        })
          .then(data => {
            assert.equal(data.length, 1)
            assert.equal(data[0].other, '#')
            done()
          })
          .catch(err => done(err))
      })
      it('Test #2', function(done) {
        fetcher.findInPUBGArray(array_find_data, {
          bool: true,
          some: '1'
        })
          .then(data => {
            assert.equal(data.length, 2)
            assert.ok(data[0].bool)
            assert.equal(data[0].some, '1')
            assert.ok(data[1].bool)
            assert.equal(data[1].some, '1')
            done()
          })
          .catch(err => done(err))
      })
      it('Test #3', function(done) {
        fetcher.findInPUBGArray(array_find_data, {
          bool: true,
          obj: {
            foo: '$$'
          }
        })
          .then(data => {
            assert.equal(data.length, 1)
            assert.ok(data[0].bool)
            assert.equal(data[0].obj.foo, '$$')
            done()
          })
          .catch(err => done(err))
      })
    })
  })
})

describe('Twitch webhook test', function() {
  it('Should successfully register to webhook request', function(done) {
    let body = {
      'hub.callback': process.env.omnic_twitch_webhook_url,
      'hub.mode': 'subscribe',
      'hub.topic': 'https://api.twitch.tv/helix/streams?user_id=',
      'hub.lease_seconds': 0
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
        assert.equal(data.status, 202)
        done()
      })
      .catch(err => {
        done(err)
      }) 
  })

})