/**
 * 실제 서버(포트 0 = 빈 포트 자동 선택)에 socket.io-client로 여러 명이 접속해 게임 전체를 진행하는 통합 테스트.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  JoinedRoom,
  LobbyRoomSummary,
  Notice,
  RoomView,
  ServerToClientEvents,
} from '../../shared/protocol.ts'
import { createGameServer } from '../../server/app.ts'
import { seededRng } from '../../server/util.ts'
import { loadWords } from '../../server/words/load.ts'

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

interface TestClient {
  name: string
  socket: ClientSocket
  states: RoomView[]
  notices: Notice[]
  lobby: LobbyRoomSummary[][]
  identity: JoinedRoom | null
  last(): RoomView
}

const words = loadWords(fileURLToPath(new URL('../fixtures/words-mini', import.meta.url))).bank
const logDir = mkdtempSync(join(tmpdir(), 'liar-test-'))
const judgeLogFile = join(logDir, 'judgements.jsonl')

let server: Awaited<ReturnType<typeof createGameServer>>
const clients: TestClient[] = []

beforeAll(async () => {
  server = await createGameServer({ port: 0, host: '127.0.0.1', words, judgeLogFile, rng: seededRng(3) })
})

afterAll(async () => {
  for (const c of clients) c.socket.disconnect()
  await server.close()
})

function connect(name: string): Promise<TestClient> {
  const socket: ClientSocket = io(server.url, { transports: ['websocket'], forceNew: true, reconnection: false })
  const client: TestClient = {
    name,
    socket,
    states: [],
    notices: [],
    lobby: [],
    identity: null,
    last() {
      const s = this.states.at(-1)
      if (!s) throw new Error(`${name}: 받은 상태가 없음`)
      return s
    },
  }
  socket.on('state', (s) => client.states.push(s))
  socket.on('notice', (n) => client.notices.push(n))
  socket.on('lobby:rooms', (rooms) => client.lobby.push(rooms))
  clients.push(client)
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(client))
    socket.once('connect_error', reject)
  })
}

async function waitFor<T>(check: () => T | undefined | false, label: string, ms = 3000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = check()
    if (v) return v
    if (Date.now() - start > ms) throw new Error(`시간 초과: ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const waitState = (c: TestClient, pred: (s: RoomView) => boolean, label: string) =>
  waitFor(() => {
    const s = c.states.at(-1)
    return s && pred(s) ? s : undefined
  }, `${c.name}: ${label}`)

async function ok<T extends object>(promise: Promise<({ ok: true } & T) | { ok: false; error: string }>): Promise<T> {
  const res = await promise
  if (!res.ok) throw new Error(`요청 실패: ${res.error}`)
  return res as T
}

const ack = (c: TestClient) => c.socket.timeout(3000)

async function createRoom(host: TestClient, roomName: string, extra: { isPrivate?: boolean; password?: string } = {}) {
  const res = await ok(
    ack(host).emitWithAck('room:create', {
      roomName,
      playerName: host.name,
      maxPlayers: 8,
      isPrivate: extra.isPrivate ?? false,
      password: extra.password,
    }),
  )
  host.identity = res
  return res.code
}

async function joinRoom(c: TestClient, code: string, password?: string) {
  c.identity = await ok(ack(c).emitWithAck('room:join', { code, playerName: c.name, password }))
}

/** 방을 만들고 n명을 입장시킨다 */
async function makeGroup(prefix: string, n: number) {
  const group: TestClient[] = []
  for (let i = 0; i < n; i++) group.push(await connect(`${prefix}${i}`))
  const code = await createRoom(group[0]!, `${prefix} 방`)
  for (const c of group.slice(1)) await joinRoom(c, code)
  await waitState(group[0]!, (s) => s.room.players.length === n, '전원 입장')
  return { group, code, host: group[0]! }
}

/** 상태를 보고 진행: 확인 → 설명(차례대로) → 토론 스킵 */
async function playToVote(group: TestClient[], host: TestClient) {
  await ok(ack(host).emitWithAck('game:start'))
  for (const c of group) await waitState(c, (s) => s.room.phase === 'ROLE_REVEAL', '제시어 확인')
  for (const c of group) await ok(ack(c).emitWithAck('game:confirmRole'))
  await waitState(host, (s) => s.room.phase === 'DESCRIBE', '설명 단계')
  for (;;) {
    const s = host.last()
    if (s.room.phase !== 'DESCRIBE') break
    const turn = s.round!.turn!
    const speaker = group.find((c) => c.identity!.playerId === turn.playerId)!
    await ok(ack(speaker).emitWithAck('game:submitHint', { text: `설명 ${turn.index}`, turnIndex: turn.index }))
    await waitState(host, (x) => x.room.phase !== 'DESCRIBE' || x.round!.turn!.index > turn.index, '다음 차례')
  }
  await waitState(host, (s) => s.room.phase === 'DISCUSS', '토론')
  await ok(ack(host).emitWithAck('game:skipPhase'))
  for (const c of group) await waitState(c, (s) => s.room.phase === 'VOTE', '투표')
}

async function voteAll(group: TestClient[], target: string) {
  for (const c of group) {
    const s = c.last()
    const me = c.identity!.playerId
    const to = me === target ? s.round!.vote!.candidates.find((id) => id !== me)! : target
    await ok(ack(c).emitWithAck('game:vote', { targetId: to, voteRound: s.round!.vote!.round }))
  }
}

/** RESULT 전 모든 상태에 라이어 정보·남의 단어가 없는지 */
function assertNoLeak(group: TestClient[], liarId: string, citizenWord: string, liarWord: string | null) {
  for (const c of group) {
    for (const s of c.states) {
      if (s.room.phase === 'RESULT' || s.room.phase === 'LOBBY') continue
      const json = JSON.stringify(s)
      expect(json).not.toContain('"liarId"')
      if (c.identity!.playerId === liarId) expect(json).not.toContain(citizenWord)
      else if (liarWord) expect(json).not.toContain(liarWord)
    }
  }
}

describe('로비', () => {
  it('공개 방만 목록에 보이고, 인원 변화가 실시간으로 반영된다', async () => {
    const watcher = await connect('구경꾼')
    const first = await ok(ack(watcher).emitWithAck('lobby:subscribe'))
    expect(Array.isArray(first.rooms)).toBe(true)

    const a = await connect('A')
    const b = await connect('B')
    const codeA = await createRoom(a, '공개방')
    await createRoom(b, '비밀방', { isPrivate: true, password: '1234' })

    const listed = await waitFor(
      () => watcher.lobby.at(-1)?.find((r) => r.code === codeA),
      '목록에 공개방 표시',
    )
    expect(listed).toMatchObject({ name: '공개방', hostName: 'A', playerCount: 1, playing: false })
    expect(watcher.lobby.at(-1)!.some((r) => r.name === '비밀방')).toBe(false)

    const c = await connect('C')
    await joinRoom(c, codeA)
    await waitFor(() => watcher.lobby.at(-1)?.find((r) => r.code === codeA && r.playerCount === 2), '인원 갱신')

    // 비밀방: 코드로 조회 가능, 비밀번호 필요
    const secretCode = b.identity!.code
    const peek = await ok(ack(watcher).emitWithAck('room:peek', { code: secretCode.toLowerCase() }))
    expect(peek.room).toMatchObject({ hasPassword: true, isPrivate: true })
    const d = await connect('D')
    const wrong = await ack(d).emitWithAck('room:join', { code: secretCode, playerName: 'D', password: 'x' })
    expect(wrong).toMatchObject({ ok: false, error: 'WRONG_PASSWORD' })
    await joinRoom(d, secretCode, '1234')

    // 방이 비면 목록에서 사라진다
    await ok(ack(a).emitWithAck('room:leave'))
    await ok(ack(c).emitWithAck('room:leave'))
    await waitFor(() => watcher.lobby.at(-1) && !watcher.lobby.at(-1)!.some((r) => r.code === codeA), '빈 방 삭제')
  })
})

describe('게임 진행', () => {
  it('라이어 모드: 검거 후 정답 → 라이어 승리', async () => {
    const { group, host } = await makeGroup('L', 4)
    await ok(ack(host).emitWithAck('room:updateSettings', { mode: 'liar', judgeMode: 'auto' }))
    await playToVote(group, host)

    const liar = group.find((c) => c.last().round!.secret.kind === 'liar')!
    const citizen = group.find((c) => c !== liar)!
    const secret = citizen.last().round!.secret
    if (secret.kind !== 'word') throw new Error('시민 단어 없음')
    for (const c of group) {
      if (c !== liar) expect(c.last().round!.secret).toEqual(secret)
    }

    await voteAll(group, liar.identity!.playerId)
    await waitState(liar, (s) => s.room.phase === 'LIAR_GUESS' && s.can.guess, '정답 도전')
    expect(citizen.last().can.guess).toBe(false)
    await ok(ack(liar).emitWithAck('game:submitGuess', { text: `${secret.word}요` }))
    const result = (await waitState(host, (s) => s.room.phase === 'RESULT', '결과')).round!.result!
    expect(result).toMatchObject({ winner: 'liar', reason: 'guessed', liarId: liar.identity!.playerId })
    expect(host.last().room.players.find((p) => p.id === liar.identity!.playerId)!.score).toBe(1)
    assertNoLeak(group, liar.identity!.playerId, secret.word, null)
  })

  it('바보 모드: 시민을 지목하면 라이어 승리, 라이어 단어는 다르다', async () => {
    const { group, host } = await makeGroup('F', 4)
    await ok(ack(host).emitWithAck('room:updateSettings', { mode: 'fool', categoryIds: ['food'] }))
    await playToVote(group, host)

    const wordsByClient = group.map((c) => {
      const s = c.last().round!.secret
      if (s.kind !== 'word') throw new Error('바보 모드에서는 모두 단어를 받아야 함')
      return s.word
    })
    const counts = new Map<string, number>()
    for (const w of wordsByClient) counts.set(w, (counts.get(w) ?? 0) + 1)
    const liarIndex = wordsByClient.findIndex((w) => counts.get(w) === 1)
    const liar = group[liarIndex]!
    const citizenWord = wordsByClient.find((w) => counts.get(w)! > 1)!
    const innocent = group.find((c) => c !== liar)!

    await voteAll(group, innocent.identity!.playerId)
    const result = (await waitState(host, (s) => s.room.phase === 'RESULT', '결과')).round!.result!
    expect(result).toMatchObject({
      reason: 'wrong_accusation',
      liarId: liar.identity!.playerId,
      citizenWord,
      liarWord: wordsByClient[liarIndex],
    })
    assertNoLeak(group, liar.identity!.playerId, citizenWord, wordsByClient[liarIndex]!)
  })

  it('애매한 정답은 사람이 판정하고 기록 파일에 남는다', async () => {
    const { group, host } = await makeGroup('J', 4)
    await ok(ack(host).emitWithAck('room:updateSettings', { judgeMode: 'host', categoryIds: ['food'] }))
    await playToVote(group, host)
    const liar = group.find((c) => c.last().round!.secret.kind === 'liar')!
    const citizen = group.find((c) => c !== liar)!
    const s = citizen.last().round!.secret
    if (s.kind !== 'word') throw new Error()
    await voteAll(group, liar.identity!.playerId)
    await waitState(liar, (x) => x.can.guess, '정답 도전')

    // 정답에서 마지막 글자를 뺀 애매한 추측 (예: 짜장면 → 짜장)
    const guess = [...s.word].slice(0, -1).join('')
    await ok(ack(liar).emitWithAck('game:submitGuess', { text: guess }))
    const judging = await waitState(citizen, (x) => x.room.phase === 'GUESS_JUDGE', '판정')
    const judge = judging.round!.judge!
    if (judge.method === 'host') {
      expect(host).not.toBe(liar)
      await ok(ack(host).emitWithAck('game:judge', { accept: true }))
    } else {
      for (const c of group) if (c !== liar) await ok(ack(c).emitWithAck('game:judge', { accept: true }))
    }
    const result = (await waitState(host, (x) => x.room.phase === 'RESULT', '결과')).round!.result!
    expect(result.judgement).toMatchObject({ guess, accepted: true })
    const logged = await waitFor(
      () => existsSync(judgeLogFile) && readFileSync(judgeLogFile, 'utf8').trim(),
      '판정 기록 파일',
    )
    const entry = JSON.parse(logged.split('\n').at(-1)!)
    expect(entry).toMatchObject({ word: s.word, guess, accepted: true, categoryId: 'food' })
  })
})

describe('재접속', () => {
  it('토큰으로 같은 플레이어로 돌아오고, 이전 연결은 TAKEN_OVER를 받는다', async () => {
    const { group, host } = await makeGroup('R', 3)
    await ok(ack(host).emitWithAck('game:start'))
    const target = group[1]!
    const before = await waitState(target, (s) => s.room.phase === 'ROLE_REVEAL', '시작')

    // 두 번째 연결로 같은 플레이어 이어받기
    const second = await connect('R1-새탭')
    const resumed = await ok(ack(second).emitWithAck('room:resume', target.identity!))
    expect(resumed.playerId).toBe(target.identity!.playerId)
    await waitFor(() => target.notices.find((n) => n.code === 'TAKEN_OVER'), 'TAKEN_OVER')
    const after = await waitState(second, (s) => s.room.phase === 'ROLE_REVEAL', '재접속 상태')
    expect(after.round!.secret).toEqual(before.round!.secret)
    expect(after.me.id).toBe(target.identity!.playerId)

    // 끊겼다가 돌아오면 접속 상태가 갱신된다
    second.socket.disconnect()
    await waitState(host, (s) => s.room.players.some((p) => p.id === target.identity!.playerId && !p.connected), '끊김 표시')
    const third = await connect('R1-복귀')
    await ok(ack(third).emitWithAck('room:resume', target.identity!))
    await waitState(host, (s) => s.room.players.every((p) => p.connected), '복귀 표시')

    // 잘못된 토큰
    const bad = await ack(third).emitWithAck('room:resume', { ...target.identity!, token: 'nope' })
    expect(bad).toMatchObject({ ok: false, error: 'AUTH_FAILED' })
  })
})

describe('방 격리', () => {
  it('두 방이 동시에 진행돼도 상태가 섞이지 않는다', async () => {
    const x = await makeGroup('X', 3)
    const y = await makeGroup('Y', 3)
    await ok(ack(x.host).emitWithAck('game:start'))
    await ok(ack(y.host).emitWithAck('game:start'))
    for (const c of x.group) await waitState(c, (s) => s.room.phase === 'ROLE_REVEAL', 'X 시작')
    for (const c of y.group) await waitState(c, (s) => s.room.phase === 'ROLE_REVEAL', 'Y 시작')
    for (const c of x.group) {
      for (const s of c.states) {
        expect(s.room.code).toBe(x.code)
        expect(JSON.stringify(s)).not.toMatch(/"Y\d"/)
      }
    }
  })
})
