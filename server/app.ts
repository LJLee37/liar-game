/**
 * HTTP 서버 + Socket.IO 서버를 만든다.
 * - 운영: 빌드된 클라이언트(dist/client)를 같은 포트에서 정적 파일로 제공한다.
 * - 개발: Vite 개발 서버가 /socket.io 요청을 이 서버로 넘겨준다 (vite.config.ts의 proxy).
 *
 * Express 문서: https://expressjs.com/ko/  /  Socket.IO 서버: https://socket.io/docs/v4/server-initialization/
 */
import { existsSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import express from 'express'
import { Server } from 'socket.io'
import type { JudgementLogEntry } from './game.ts'
import { Lobby } from './lobby.ts'
import { attachSocketLayer } from './socket.ts'
import type { GameServer } from './socket.ts'
import type { Rng } from './util.ts'
import type { WordBank } from './words/types.ts'

export interface GameServerOptions {
  port: number
  host?: string
  words: WordBank
  /** 빌드된 클라이언트 폴더. 없으면 API만 제공 */
  clientDir?: string | null
  /** 사람이 판정한 추측을 기록할 JSONL 파일. null이면 기록하지 않음 */
  judgeLogFile?: string | null
  maxRooms?: number
  rng?: Rng
  log?: (message: string) => void
}

export async function createGameServer(options: GameServerOptions) {
  const log = options.log ?? (() => {})
  const app = express()
  app.disable('x-powered-by')

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: lobby.rooms.size })
  })

  const clientDir = options.clientDir
  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }))
    // Vue Router의 주소(/room/ABCD 등)를 새로고침해도 index.html을 돌려준다
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(join(clientDir, 'index.html'))
    })
  } else if (clientDir) {
    log(`클라이언트 빌드가 없어요 (${clientDir}). 'npm run build'를 먼저 실행하거나 개발 모드(npm run dev)를 쓰세요.`)
  }

  const httpServer = createServer(app)
  const io: GameServer = new Server(httpServer, {
    maxHttpBufferSize: 10_000,
    serveClient: false,
  })

  const lobby = new Lobby({ maxRooms: options.maxRooms ?? 100 })

  const judgeLogFile = options.judgeLogFile ?? null
  const onJudgement = judgeLogFile
    ? (entry: JudgementLogEntry) => {
        mkdir(dirname(judgeLogFile), { recursive: true })
          .then(() => appendFile(judgeLogFile, `${JSON.stringify(entry)}\n`))
          .catch((err: unknown) => log(`판정 기록 실패: ${String(err)}`))
      }
    : undefined

  const layer = attachSocketLayer({
    io,
    lobby,
    words: options.words,
    rng: options.rng ?? Math.random,
    onJudgement,
    log,
  })

  await new Promise<void>((resolve) => httpServer.listen(options.port, options.host ?? '0.0.0.0', resolve))
  const address = httpServer.address() as AddressInfo
  const url = `http://${address.address === '0.0.0.0' || address.address === '::' ? 'localhost' : address.address}:${address.port}`

  return {
    httpServer,
    io,
    lobby,
    url,
    port: address.port,
    async close() {
      layer.shutdown()
      await io.close()
    },
  }
}
