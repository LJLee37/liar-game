/**
 * Socket.IO 연결 계층: 클라이언트 이벤트를 받아 lobby.ts / game.ts 함수를 부르고,
 * 바뀐 상태를 플레이어마다 따로 계산해(viewFor) 보낸다.
 *
 * - 방 상태를 통째로 방송(broadcast)하지 않는다. 그러면 라이어 정보가 모두에게 가기 때문이다.
 * - 방마다 타이머 하나: game.nextDeadline()이 알려 주는 시각에 game.tick()을 부른다.
 * - 재접속: 클라이언트가 저장해 둔 (방 코드, 플레이어 id, 토큰)으로 room:resume을 보내면 같은 플레이어로 이어진다.
 *
 * Socket.IO 문서: https://socket.io/docs/v4/server-api/
 */
import { timingSafeEqual } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import { ERROR_MESSAGES } from '../shared/constants.ts'
import type {
  AckResponse,
  ClientToServerEvents,
  ErrorCode,
  JoinedRoom,
  LobbyRoomSummary,
  Notice,
  ServerToClientEvents,
} from '../shared/protocol.ts'
import * as game from './game.ts'
import type { GameContext, JudgementLogEntry, Result, Room } from './game.ts'
import type { Lobby } from './lobby.ts'
import type { Rng } from './util.ts'
import type { WordBank } from './words/types.ts'

interface SocketData {
  roomCode?: string
  playerId?: string
  eventTimes: number[]
  lastChatAt: number
  lastCreateAt: number
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

export interface SocketLayerOptions {
  io: GameServer
  lobby: Lobby
  words: WordBank
  rng: Rng
  now?: () => number
  onJudgement?: (entry: JudgementLogEntry) => void
  log?: (message: string) => void
}

/** 초당 이벤트 수 제한 */
const RATE_WINDOW_MS = 1000
const RATE_MAX_EVENTS = 15
const CHAT_INTERVAL_MS = 700
const CREATE_INTERVAL_MS = 5000
const LOBBY_BROADCAST_DELAY_MS = 300
const GC_INTERVAL_MS = 60_000

const LOBBY_CHANNEL = 'lobby'

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function errorResponse(error: ErrorCode): AckResponse<never> {
  return { ok: false, error, message: ERROR_MESSAGES[error] }
}

export function attachSocketLayer(options: SocketLayerOptions) {
  const { io, lobby, words, rng, onJudgement } = options
  const now = options.now ?? Date.now
  const log = options.log ?? (() => {})
  const ctx = (): GameContext => ({ now: now(), rng, words })

  /** 플레이어 id → 현재 연결된 소켓 */
  const playerSockets = new Map<string, GameSocket>()
  const timers = new Map<string, NodeJS.Timeout>()
  const firedDeadlines = new Map<string, number>()
  const pendingState = new Set<string>()
  let flushQueued = false
  let lobbyTimer: NodeJS.Timeout | null = null

  // ── 상태 전송 ──────────────────────────────────────────────

  function queueState(code: string) {
    pendingState.add(code)
    if (flushQueued) return
    flushQueued = true
    // 같은 순간에 일어난 여러 변경을 한 번의 전송으로 묶는다
    queueMicrotask(() => {
      flushQueued = false
      const c = ctx()
      for (const roomCode of pendingState) {
        const room = lobby.get(roomCode)
        if (!room) continue
        for (const playerId of room.players.keys()) {
          playerSockets.get(playerId)?.emit('state', game.viewFor(room, playerId, c))
        }
      }
      pendingState.clear()
    })
  }

  function markLobbyDirty() {
    if (lobbyTimer) return
    lobbyTimer = setTimeout(() => {
      lobbyTimer = null
      io.to(LOBBY_CHANNEL).emit('lobby:rooms', lobby.publicSummaries())
    }, LOBBY_BROADCAST_DELAY_MS)
  }

  function notify(playerId: string, notice: Notice) {
    playerSockets.get(playerId)?.emit('notice', notice)
  }

  // ── 타이머 ──────────────────────────────────────────────────

  function reschedule(room: Room) {
    const existing = timers.get(room.code)
    if (existing) clearTimeout(existing)
    timers.delete(room.code)
    const deadline = game.nextDeadline(room)
    if (deadline === null) return
    const code = room.code
    // 같은 마감 시각이 처리 후에도 그대로 남아 있으면(이론상 없어야 함) 바쁜 반복을 막기 위해 1초 쉰다
    const repeated = firedDeadlines.get(code) === deadline
    const delay = repeated ? 1000 : Math.max(0, deadline - now()) + 10
    timers.set(
      code,
      setTimeout(() => {
        timers.delete(code)
        firedDeadlines.set(code, deadline)
        const r = lobby.get(code)
        if (!r) return
        game.tick(r, ctx())
        afterChange(r)
      }, delay),
    )
  }

  // ── 방 상태가 바뀐 뒤 공통 처리 ───────────────────────────────

  function afterChange(room: Room) {
    for (const effect of room.effects.splice(0)) {
      switch (effect.type) {
        case 'judgement-log':
          onJudgement?.(effect.entry)
          break
        case 'notice':
          if (effect.to === null) for (const id of room.players.keys()) notify(id, effect.notice)
          else notify(effect.to, effect.notice)
          break
        case 'removed': {
          const s = playerSockets.get(effect.playerId)
          playerSockets.delete(effect.playerId)
          if (!s) break
          if (effect.reason === 'kick') {
            s.emit('notice', { code: 'KICKED', level: 'warning', message: '방장이 나를 방에서 내보냈어요.' })
          } else if (effect.reason === 'idle') {
            s.emit('notice', { code: 'REMOVED', level: 'warning', message: '오래 접속하지 않아 방에서 나가졌어요.' })
          }
          unbind(s)
          break
        }
      }
    }
    if (room.players.size === 0) {
      closeRoom(room.code, null)
      return
    }
    queueState(room.code)
    reschedule(room)
    markLobbyDirty()
  }

  function closeRoom(code: string, notice: Notice | null) {
    const room = lobby.get(code)
    if (room) {
      for (const id of room.players.keys()) {
        const s = playerSockets.get(id)
        playerSockets.delete(id)
        if (!s) continue
        if (notice) s.emit('notice', notice)
        unbind(s)
      }
    }
    const t = timers.get(code)
    if (t) clearTimeout(t)
    timers.delete(code)
    firedDeadlines.delete(code)
    lobby.delete(code)
    log(`방 삭제: ${code}`)
    markLobbyDirty()
  }

  // ── 소켓 ↔ 플레이어 연결 ─────────────────────────────────────

  function unbind(socket: GameSocket) {
    socket.data.roomCode = undefined
    socket.data.playerId = undefined
  }

  function bind(socket: GameSocket, room: Room, playerId: string) {
    const previous = playerSockets.get(playerId)
    if (previous && previous !== socket) {
      // 같은 플레이어가 다른 탭·기기에서 다시 접속 → 이전 연결을 끊는다
      previous.emit('notice', {
        code: 'TAKEN_OVER',
        level: 'warning',
        message: '다른 탭이나 기기에서 같은 플레이어로 접속해서 이 화면의 연결을 끊었어요.',
      })
      unbind(previous)
    }
    socket.data.roomCode = room.code
    socket.data.playerId = playerId
    playerSockets.set(playerId, socket)
    socket.leave(LOBBY_CHANNEL)
  }

  /** 이 소켓이 다른 방에 들어가 있으면 먼저 나간다 */
  function leaveCurrent(socket: GameSocket) {
    const { roomCode, playerId } = socket.data
    if (!roomCode || !playerId) return
    const room = lobby.get(roomCode)
    unbind(socket)
    if (playerSockets.get(playerId) === socket) playerSockets.delete(playerId)
    if (!room) return
    game.removePlayer(room, playerId, 'leave', ctx())
    afterChange(room)
  }

  // ── 이벤트 처리 공통 ──────────────────────────────────────────

  function rateLimited(socket: GameSocket): boolean {
    const t = now()
    const times = socket.data.eventTimes.filter((x) => t - x < RATE_WINDOW_MS)
    times.push(t)
    socket.data.eventTimes = times
    return times.length > RATE_MAX_EVENTS
  }

  /** 응답 콜백 검사, 속도 제한, 예외 처리를 감싼다. */
  function handle<T extends object>(socket: GameSocket, ack: unknown, fn: () => Result<T>) {
    const reply = typeof ack === 'function' ? (ack as (res: AckResponse<T>) => void) : () => {}
    if (rateLimited(socket)) return reply(errorResponse('RATE_LIMITED'))
    try {
      const result = fn()
      reply(result.ok ? result : errorResponse(result.error))
    } catch (err) {
      log(`처리 중 오류: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      reply(errorResponse('INTERNAL'))
    }
  }

  /** 방에 들어가 있는 플레이어의 행동 */
  function inRoom(socket: GameSocket, ack: unknown, fn: (room: Room, playerId: string, c: GameContext) => Result) {
    handle(socket, ack, () => {
      const { roomCode, playerId } = socket.data
      const room = roomCode ? lobby.get(roomCode) : undefined
      if (!room || !playerId || !room.players.has(playerId)) return { ok: false, error: 'NOT_IN_ROOM' }
      const result = fn(room, playerId, ctx())
      afterChange(room)
      return result
    })
  }

  // ── 연결 ────────────────────────────────────────────────────

  io.on('connection', (socket: GameSocket) => {
    socket.data.eventTimes = []
    socket.data.lastChatAt = 0
    socket.data.lastCreateAt = 0

    socket.on('lobby:subscribe', (ack) =>
      handle<{ rooms: LobbyRoomSummary[] }>(socket, ack, () => {
        socket.join(LOBBY_CHANNEL)
        return { ok: true, rooms: lobby.publicSummaries() }
      }),
    )

    socket.on('lobby:unsubscribe', () => {
      socket.leave(LOBBY_CHANNEL)
    })

    socket.on('room:create', (payload, ack) =>
      handle<JoinedRoom>(socket, ack, () => {
        const t = now()
        if (t - socket.data.lastCreateAt < CREATE_INTERVAL_MS) return { ok: false, error: 'RATE_LIMITED' }
        leaveCurrent(socket)
        const result = lobby.create(payload, ctx())
        if (!result.ok) return result
        socket.data.lastCreateAt = t
        const { room, player } = result
        bind(socket, room, player.id)
        log(`방 생성: ${room.code} "${room.name}"`)
        afterChange(room)
        return { ok: true, code: room.code, playerId: player.id, token: player.token }
      }),
    )

    socket.on('room:peek', (payload, ack) =>
      handle<{ room: LobbyRoomSummary }>(socket, ack, () => {
        const room = lobby.get(payload?.code)
        if (!room || room.players.size === 0) return { ok: false, error: 'NOT_FOUND' }
        return { ok: true, room: lobby.summary(room) }
      }),
    )

    socket.on('room:join', (payload, ack) =>
      handle<JoinedRoom>(socket, ack, () => {
        const room = lobby.get(payload?.code)
        if (!room || room.players.size === 0) return { ok: false, error: 'NOT_FOUND' }
        if (!lobby.checkPassword(room, payload.password)) return { ok: false, error: 'WRONG_PASSWORD' }
        if (socket.data.roomCode === room.code) return { ok: false, error: 'ALREADY_IN_ROOM' }
        const c = ctx()
        const result = game.addPlayer(room, payload.playerName, c)
        if (!result.ok) return result
        leaveCurrent(socket)
        bind(socket, room, result.player.id)
        afterChange(room)
        return { ok: true, code: room.code, playerId: result.player.id, token: result.player.token }
      }),
    )

    socket.on('room:resume', (payload, ack) =>
      handle<JoinedRoom>(socket, ack, () => {
        const room = lobby.get(payload?.code)
        if (!room) return { ok: false, error: 'NOT_FOUND' }
        const player = typeof payload.playerId === 'string' ? room.players.get(payload.playerId) : undefined
        if (!player || typeof payload.token !== 'string' || !sameSecret(payload.token, player.token)) {
          return { ok: false, error: 'AUTH_FAILED' }
        }
        if (socket.data.playerId && socket.data.playerId !== player.id) leaveCurrent(socket)
        bind(socket, room, player.id)
        game.setConnected(room, player.id, true, ctx())
        afterChange(room)
        return { ok: true, code: room.code, playerId: player.id, token: player.token }
      }),
    )

    socket.on('room:leave', (ack) =>
      handle<object>(socket, ack, () => {
        if (!socket.data.playerId) return { ok: false, error: 'NOT_IN_ROOM' }
        leaveCurrent(socket)
        return { ok: true }
      }),
    )

    socket.on('room:kick', (payload, ack) => inRoom(socket, ack, (r, me, c) => game.kick(r, me, payload?.playerId, c)))
    socket.on('room:transferHost', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => game.transferHost(r, me, payload?.playerId, c)),
    )
    socket.on('room:updateSettings', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => game.updateSettings(r, me, payload, c)),
    )
    socket.on('room:resetScores', (ack) => inRoom(socket, ack, (r, me) => game.resetScores(r, me)))

    socket.on('chat:send', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => {
        if (c.now - socket.data.lastChatAt < CHAT_INTERVAL_MS) return { ok: false, error: 'RATE_LIMITED' }
        const result = game.sendChat(r, me, payload?.text, c)
        if (result.ok) socket.data.lastChatAt = c.now
        return result
      }),
    )

    socket.on('game:start', (ack) => inRoom(socket, ack, (r, me, c) => game.startGame(r, me, c)))
    socket.on('game:confirmRole', (ack) => inRoom(socket, ack, (r, me, c) => game.confirmRole(r, me, c)))
    socket.on('game:submitHint', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => game.submitHint(r, me, payload?.text, payload?.turnIndex, c)),
    )
    socket.on('game:ready', (payload, ack) => inRoom(socket, ack, (r, me, c) => game.setReady(r, me, payload?.ready, c)))
    socket.on('game:skipPhase', (ack) => inRoom(socket, ack, (r, me, c) => game.skipPhase(r, me, c)))
    socket.on('game:vote', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => game.castVote(r, me, payload?.targetId, payload?.voteRound, c)),
    )
    socket.on('game:submitGuess', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => game.submitGuess(r, me, payload?.text, c)),
    )
    socket.on('game:judge', (payload, ack) =>
      inRoom(socket, ack, (r, me, c) => game.judgeDecision(r, me, payload?.accept, c)),
    )
    socket.on('game:abort', (ack) => inRoom(socket, ack, (r, me, c) => game.abortRound(r, me, c)))
    socket.on('game:toLobby', (ack) => inRoom(socket, ack, (r, me, c) => game.backToLobby(r, me, c)))

    socket.on('disconnect', () => {
      const { roomCode, playerId } = socket.data
      if (!roomCode || !playerId || playerSockets.get(playerId) !== socket) return
      playerSockets.delete(playerId)
      const room = lobby.get(roomCode)
      if (!room) return
      game.setConnected(room, playerId, false, ctx())
      afterChange(room)
    })
  })

  // 빈 방·오래된 방 정리
  const gcTimer = setInterval(() => {
    for (const code of lobby.expired(now())) {
      closeRoom(code, { code: 'ROOM_CLOSED', level: 'warning', message: '오랫동안 사용하지 않아 방이 닫혔어요.' })
    }
  }, GC_INTERVAL_MS)
  gcTimer.unref()

  return {
    /** 테스트·종료용: 모든 타이머 정리 */
    shutdown() {
      clearInterval(gcTimer)
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      if (lobbyTimer) clearTimeout(lobbyTimer)
      lobbyTimer = null
    },
  }
}
