/**
 * 방 하나의 게임 상태 머신.
 *
 * - 네트워크·타이머·파일 입출력이 전혀 없는 "순수 로직"이다. 현재 시각(now)과 난수(rng)를
 *   GameContext로 받아서, 테스트에서 시간을 마음대로 돌리며 검증할 수 있다.
 * - 실제 타이머는 socket.ts가 nextDeadline()을 보고 setTimeout을 걸고, 시간이 되면 tick()을 부른다.
 * - 각 플레이어에게 보낼 화면 정보는 viewFor()가 만든다. 다른 사람의 제시어나 라이어가 누구인지는
 *   결과 화면 전까지 절대 넣지 않는다.
 *
 * 진행 단계: LOBBY → ROLE_REVEAL → DESCRIBE → DISCUSS → VOTE → (LIAR_GUESS → GUESS_JUDGE) → RESULT
 */
import { DEFAULT_SETTINGS, LIMITS, SCORE, SETTING_RANGES, TIMINGS } from '../shared/constants.ts'
import type {
  Capabilities,
  ChatMessage,
  ErrorCode,
  GameMode,
  JudgeMode,
  JudgementView,
  Notice,
  Phase,
  ResultReason,
  RoomSettings,
  RoomSettingsUpdate,
  RoomView,
  RoundView,
  Secret,
} from '../shared/protocol.ts'
import { hintRevealsWord, judgeGuess, normalize } from './judge.ts'
import type { JudgeResult } from './judge.ts'
import { pick, randomId, shuffle } from './util.ts'
import type { Rng } from './util.ts'
import { cleanText } from './words/load.ts'
import type { Category, Word, WordBank } from './words/types.ts'

// ── 타입 ──────────────────────────────────────────────────────

export interface GameContext {
  now: number
  rng: Rng
  words: WordBank
}

export interface Player {
  id: string
  /** 재접속용 비밀 토큰 (본인에게만 전달) */
  token: string
  name: string
  connected: boolean
  disconnectedAt: number | null
  /** 입장 순서 (방장 위임 순서) */
  joinOrder: number
}

export interface JudgementLogEntry {
  at: string
  room: string
  categoryId: string
  category: string
  word: string
  guess: string
  accepted: boolean
  method: 'host' | 'vote'
  similarity: number
}

/** 상태 변화와 함께 socket.ts가 처리해야 할 부수 효과 */
export type Effect =
  | { type: 'judgement-log'; entry: JudgementLogEntry }
  | { type: 'notice'; to: string | null; notice: Notice }
  /** 플레이어가 방에서 제거됨 (강퇴·장시간 미접속) → 소켓 정리 */
  | { type: 'removed'; playerId: string; reason: 'kick' | 'idle' | 'leave' }

interface Hint {
  playerId: string
  lap: number
  text: string
  status: 'ok' | 'timeout' | 'skipped'
}

interface VoteState {
  round: 1 | 2
  candidates: string[]
  votes: Map<string, string>
  prevTally: Record<string, number> | null
}

interface JudgeState {
  method: 'host' | 'vote'
  judgeIds: string[]
  votes: Map<string, boolean>
}

export interface Round {
  no: number
  mode: GameMode
  category: Category
  citizenWord: Word
  liarWord: Word | null
  liarId: string
  participants: string[]
  names: Record<string, string>
  order: string[]
  left: Set<string>
  confirmed: Set<string>
  turnIndex: number
  hints: Hint[]
  ready: Set<string>
  vote: VoteState | null
  voteHistory: { voterId: string; targetId: string; round: 1 | 2 }[]
  accusedId: string | null
  guess: string | null
  guessResult: JudgeResult | null
  judge: JudgeState | null
  judgeVotes: { judgeId: string; accept: boolean }[]
  judgement: JudgementView | null
  winner: 'liar' | 'citizens' | null
  reason: ResultReason | null
  scoreDelta: Record<string, number>
}

export interface Room {
  code: string
  name: string
  isPrivate: boolean
  /** 비밀번호 해시 (lobby.ts에서 관리). 없으면 null */
  passwordHash: string | null
  maxPlayers: number
  createdAt: number
  hostId: string
  players: Map<string, Player>
  joinSeq: number
  settings: RoomSettings
  phase: Phase
  phaseEndsAt: number | null
  roundNo: number
  scores: Map<string, number>
  chat: ChatMessage[]
  chatSeq: number
  /** 카테고리 id → 이 방에서 이미 출제한 단어 (같은 단어 반복 방지) */
  usedWords: Map<string, Set<string>>
  round: Round | null
  /** socket.ts가 꺼내 처리할 부수 효과 */
  effects: Effect[]
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode }

const ok = (): Result => ({ ok: true })
const fail = (error: ErrorCode): { ok: false; error: ErrorCode } => ({ ok: false, error })

// ── 방·플레이어 ────────────────────────────────────────────────

export interface CreateRoomInput {
  code: string
  name: string
  isPrivate: boolean
  passwordHash: string | null
  maxPlayers: number
  hostName: string
}

/** 글자 수 (이모지·한글도 1자로 셈) */
function textLength(s: string): number {
  return [...s].length
}

export function validatePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = cleanText(raw)
  const len = textLength(name)
  if (len < LIMITS.playerName.min || len > LIMITS.playerName.max || !normalize(name)) return null
  return name
}

export function createRoom(input: CreateRoomInput, ctx: GameContext): Result<{ room: Room; player: Player }> {
  const hostName = validatePlayerName(input.hostName)
  if (!hostName) return fail('NAME_INVALID')
  const room: Room = {
    code: input.code,
    name: input.name,
    isPrivate: input.isPrivate,
    passwordHash: input.passwordHash,
    maxPlayers: input.maxPlayers,
    createdAt: ctx.now,
    hostId: '',
    players: new Map(),
    joinSeq: 0,
    settings: { ...DEFAULT_SETTINGS, categoryIds: [] },
    phase: 'LOBBY',
    phaseEndsAt: null,
    roundNo: 0,
    scores: new Map(),
    chat: [],
    chatSeq: 0,
    usedWords: new Map(),
    round: null,
    effects: [],
  }
  const player = newPlayer(room, hostName)
  room.hostId = player.id
  systemChat(room, `${player.name}님이 방을 만들었어요.`, ctx)
  return { ok: true, room, player }
}

function newPlayer(room: Room, name: string): Player {
  const player: Player = {
    id: randomId(9),
    token: randomId(18),
    name,
    connected: true,
    disconnectedAt: null,
    joinOrder: room.joinSeq++,
  }
  room.players.set(player.id, player)
  room.scores.set(player.id, 0)
  return player
}

export function addPlayer(room: Room, rawName: unknown, ctx: GameContext): Result<{ player: Player }> {
  const name = validatePlayerName(rawName)
  if (!name) return fail('NAME_INVALID')
  const key = normalize(name)
  for (const p of room.players.values()) if (normalize(p.name) === key) return fail('NAME_TAKEN')
  if (room.players.size >= room.maxPlayers) return fail('ROOM_FULL')
  const player = newPlayer(room, name)
  // 모두 나간 빈 방에 다시 들어온 경우 (보통은 lobby.ts가 빈 방을 지운다)
  if (!room.players.has(room.hostId)) room.hostId = player.id
  systemChat(
    room,
    isRoundActive(room) ? `${player.name}님이 들어왔어요. (다음 라운드부터 참가)` : `${player.name}님이 들어왔어요.`,
    ctx,
  )
  return { ok: true, player }
}

function playersByJoin(room: Room): Player[] {
  return [...room.players.values()].sort((a, b) => a.joinOrder - b.joinOrder)
}

/** 방에서 나가기·강퇴·장시간 미접속 */
export function removePlayer(room: Room, playerId: string, reason: 'leave' | 'kick' | 'idle', ctx: GameContext): void {
  const player = room.players.get(playerId)
  if (!player) return
  room.players.delete(playerId)
  room.scores.delete(playerId)
  const text =
    reason === 'kick'
      ? `${player.name}님이 강퇴되었어요.`
      : reason === 'idle'
        ? `${player.name}님이 오래 접속하지 않아 방에서 나갔어요.`
        : `${player.name}님이 나갔어요.`
  systemChat(room, text, ctx)
  room.effects.push({ type: 'removed', playerId, reason })

  if (room.players.size === 0) return

  let hostChanged = false
  if (playerId === room.hostId) {
    const next = playersByJoin(room).find((p) => p.connected) ?? playersByJoin(room)[0]!
    room.hostId = next.id
    systemChat(room, `${next.name}님이 방장이 되었어요.`, ctx)
    hostChanged = true
  }

  const round = room.round
  if (round && isRoundActive(room) && isActive(round, playerId)) {
    round.left.add(playerId)
    handleParticipantLeft(room, round, playerId, ctx)
  }
  if (hostChanged) onHostChanged(room, ctx)
}

export function setConnected(room: Room, playerId: string, connected: boolean, ctx: GameContext): void {
  const player = room.players.get(playerId)
  if (!player || player.connected === connected) return
  player.connected = connected
  player.disconnectedAt = connected ? null : ctx.now
  const round = room.round
  if (connected || !round || !isRoundActive(room)) return

  switch (room.phase) {
    case 'ROLE_REVEAL':
      checkAllConfirmed(room, round, ctx)
      break
    case 'DESCRIBE':
      if (currentSpeaker(round) === playerId && room.phaseEndsAt !== null) {
        room.phaseEndsAt = Math.min(room.phaseEndsAt, ctx.now + TIMINGS.describeDisconnectGrace)
      }
      break
    case 'DISCUSS':
      checkAllReady(room, round, ctx)
      break
    case 'VOTE':
      checkAllVoted(room, round, ctx)
      break
    case 'LIAR_GUESS':
      if (playerId === round.liarId && room.phaseEndsAt !== null) {
        room.phaseEndsAt = Math.min(room.phaseEndsAt, ctx.now + TIMINGS.liarGuessDisconnected)
      }
      break
    case 'GUESS_JUDGE':
      if (round.judge?.method === 'vote') checkJudgeVotes(room, round, ctx)
      break
  }
}

export function kick(room: Room, actorId: string, targetId: string, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  if (isRoundActive(room)) return fail('WRONG_PHASE')
  if (targetId === actorId || !room.players.has(targetId)) return fail('INVALID')
  removePlayer(room, targetId, 'kick', ctx)
  return ok()
}

export function transferHost(room: Room, actorId: string, targetId: string, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  const target = room.players.get(targetId)
  if (!target || targetId === actorId || !target.connected) return fail('INVALID')
  setHost(room, targetId, ctx)
  return ok()
}

function setHost(room: Room, playerId: string, ctx: GameContext) {
  room.hostId = playerId
  systemChat(room, `${room.players.get(playerId)!.name}님이 방장이 되었어요.`, ctx)
  onHostChanged(room, ctx)
}

/** 방장 판정 중에 방장이 바뀌면 (새 방장이 라이어일 수도 있으므로) 플레이어 투표로 전환 */
function onHostChanged(room: Room, ctx: GameContext) {
  const round = room.round
  if (room.phase === 'GUESS_JUDGE' && round?.judge?.method === 'host') startGuessJudge(room, round, 'vote', ctx)
}

// ── 설정 ──────────────────────────────────────────────────────

const MODES: GameMode[] = ['liar', 'fool']
const JUDGE_MODES: JudgeMode[] = ['auto', 'host', 'vote']

function intInRange(v: unknown, range: { min: number; max: number }): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= range.min && v <= range.max ? v : null
}

export function updateSettings(room: Room, actorId: string, update: RoomSettingsUpdate, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  if (isRoundActive(room)) return fail('WRONG_PHASE')
  if (typeof update !== 'object' || update === null) return fail('INVALID')

  const next: RoomSettings = { ...room.settings }
  if (update.mode !== undefined) {
    if (!MODES.includes(update.mode)) return fail('INVALID')
    next.mode = update.mode
  }
  if (update.judgeMode !== undefined) {
    if (!JUDGE_MODES.includes(update.judgeMode)) return fail('INVALID')
    next.judgeMode = update.judgeMode
  }
  if (update.categoryIds !== undefined) {
    if (!Array.isArray(update.categoryIds) || update.categoryIds.some((id) => typeof id !== 'string')) return fail('INVALID')
    next.categoryIds = [...new Set(update.categoryIds)].filter((id) => ctx.words.byId.has(id))
  }
  for (const key of ['laps', 'hintSeconds', 'discussSeconds'] as const) {
    if (update[key] === undefined) continue
    const v = intInRange(update[key], SETTING_RANGES[key])
    if (v === null) return fail('INVALID')
    next[key] = v
  }
  let maxPlayers = room.maxPlayers
  if (update.maxPlayers !== undefined) {
    const v = intInRange(update.maxPlayers, LIMITS.maxPlayers)
    if (v === null || v < room.players.size) return fail('INVALID')
    maxPlayers = v
  }
  room.settings = next
  room.maxPlayers = maxPlayers
  return ok()
}

export function resetScores(room: Room, actorId: string): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  if (isRoundActive(room)) return fail('WRONG_PHASE')
  for (const id of room.scores.keys()) room.scores.set(id, 0)
  return ok()
}

// ── 채팅 ──────────────────────────────────────────────────────

function pushChat(room: Room, msg: Omit<ChatMessage, 'id'>) {
  room.chat.push({ id: ++room.chatSeq, ...msg })
  if (room.chat.length > LIMITS.chatHistory) room.chat.splice(0, room.chat.length - LIMITS.chatHistory)
}

function systemChat(room: Room, text: string, ctx: GameContext) {
  pushChat(room, { playerId: null, name: '', text, at: ctx.now })
}

function canChat(room: Room, playerId: string): boolean {
  switch (room.phase) {
    case 'LOBBY':
    case 'RESULT':
      return true
    case 'ROLE_REVEAL':
    case 'DESCRIBE':
      // 설명은 순서대로 한 줄씩만: 이 단계에서는 채팅을 막는다.
      return false
    default:
      return !!room.round && isActive(room.round, playerId)
  }
}

export function sendChat(room: Room, playerId: string, rawText: unknown, ctx: GameContext): Result {
  const player = room.players.get(playerId)
  if (!player) return fail('NOT_IN_ROOM')
  if (!canChat(room, playerId)) return fail('WRONG_PHASE')
  if (typeof rawText !== 'string') return fail('INVALID')
  const text = cleanText(rawText)
  const len = textLength(text)
  if (len < LIMITS.chat.min || len > LIMITS.chat.max) return fail('INVALID')
  pushChat(room, { playerId, name: player.name, text, at: ctx.now })
  return ok()
}

// ── 라운드 진행 도우미 ────────────────────────────────────────

export function isRoundActive(room: Room): boolean {
  return room.phase !== 'LOBBY' && room.phase !== 'RESULT'
}

function isActive(round: Round, playerId: string): boolean {
  return round.participants.includes(playerId) && !round.left.has(playerId)
}

function activeIds(round: Round): string[] {
  return round.participants.filter((id) => !round.left.has(id))
}

function connectedActive(room: Room, round: Round): string[] {
  return activeIds(round).filter((id) => room.players.get(id)?.connected)
}

function setPhase(room: Room, phase: Phase, durationMs: number | null, ctx: GameContext) {
  room.phase = phase
  room.phaseEndsAt = durationMs === null ? null : ctx.now + durationMs
}

function totalTurns(room: Room, round: Round): number {
  return round.order.length * room.settings.laps
}

function currentSpeaker(round: Round): string | null {
  return round.order[round.turnIndex % round.order.length] ?? null
}

// ── 게임 시작 ────────────────────────────────────────────────

/** 출제 가능한 카테고리: 설정에서 고른 것(없으면 전체) 중 단어가 2개 이상인 것 */
function categoryPool(room: Room, words: WordBank): Category[] {
  const chosen = room.settings.categoryIds.map((id) => words.byId.get(id)).filter((c): c is Category => !!c)
  return (chosen.length > 0 ? chosen : words.categories).filter((c) => c.words.length >= 2)
}

function pickCitizenWord(room: Room, cat: Category, rng: Rng): Word {
  let used = room.usedWords.get(cat.id)
  if (!used) {
    used = new Set()
    room.usedWords.set(cat.id, used)
  }
  let candidates = cat.words.filter((w) => !used.has(w.text))
  if (candidates.length === 0) {
    used.clear()
    candidates = cat.words
  }
  const word = pick(candidates, rng)
  used.add(word.text)
  return word
}

/** 바보 모드: 같은 소분류의 다른 단어를 우선, 없으면 카테고리 전체에서 */
function pickLiarWord(cat: Category, citizen: Word, rng: Rng): Word {
  const others = cat.words.filter((w) => w !== citizen && !w.keys.some((k) => citizen.keys.includes(k)))
  const sameGroup = citizen.group === null ? [] : others.filter((w) => w.group === citizen.group)
  return pick(sameGroup.length > 0 ? sameGroup : others, rng)
}

export function startGame(room: Room, actorId: string, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  if (isRoundActive(room)) return fail('WRONG_PHASE')
  const participants = playersByJoin(room)
    .filter((p) => p.connected)
    .map((p) => p.id)
  if (participants.length < LIMITS.minPlayers) return fail('NOT_ENOUGH_PLAYERS')
  const pool = categoryPool(room, ctx.words)
  if (pool.length === 0) return fail('NO_CATEGORIES')

  const category = pick(pool, ctx.rng)
  const citizenWord = pickCitizenWord(room, category, ctx.rng)
  const mode = room.settings.mode
  const liarWord = mode === 'fool' ? pickLiarWord(category, citizenWord, ctx.rng) : null
  const liarId = pick(participants, ctx.rng)

  room.roundNo++
  room.round = {
    no: room.roundNo,
    mode,
    category,
    citizenWord,
    liarWord,
    liarId,
    participants,
    names: Object.fromEntries(participants.map((id) => [id, room.players.get(id)!.name])),
    order: shuffle(participants, ctx.rng),
    left: new Set(),
    confirmed: new Set(),
    turnIndex: 0,
    hints: [],
    ready: new Set(),
    vote: null,
    voteHistory: [],
    accusedId: null,
    guess: null,
    guessResult: null,
    judge: null,
    judgeVotes: [],
    judgement: null,
    winner: null,
    reason: null,
    scoreDelta: {},
  }
  systemChat(room, `${room.roundNo}라운드를 시작합니다. 카테고리: ${category.name}`, ctx)
  setPhase(room, 'ROLE_REVEAL', TIMINGS.roleReveal, ctx)
  return ok()
}

// ── ROLE_REVEAL ──────────────────────────────────────────────

export function confirmRole(room: Room, playerId: string, ctx: GameContext): Result {
  const round = room.round
  if (room.phase !== 'ROLE_REVEAL' || !round) return fail('WRONG_PHASE')
  if (!isActive(round, playerId)) return fail('NOT_ALLOWED')
  round.confirmed.add(playerId)
  checkAllConfirmed(room, round, ctx)
  return ok()
}

function checkAllConfirmed(room: Room, round: Round, ctx: GameContext) {
  const waiting = connectedActive(room, round)
  if (waiting.length > 0 && waiting.every((id) => round.confirmed.has(id))) startDescribe(room, round, ctx)
}

// ── DESCRIBE ─────────────────────────────────────────────────

function startDescribe(room: Room, round: Round, ctx: GameContext) {
  room.phase = 'DESCRIBE'
  round.turnIndex = 0
  beginTurn(room, round, ctx)
}

function beginTurn(room: Room, round: Round, ctx: GameContext) {
  const total = totalTurns(room, round)
  while (round.turnIndex < total) {
    const speaker = currentSpeaker(round)!
    if (!round.left.has(speaker)) {
      const connected = room.players.get(speaker)?.connected ?? false
      setPhase(room, 'DESCRIBE', connected ? room.settings.hintSeconds * 1000 : TIMINGS.describeDisconnected, ctx)
      return
    }
    round.turnIndex++ // 나간 사람 차례는 건너뜀
  }
  startDiscuss(room, round, ctx)
}

function advanceTurn(room: Room, round: Round, status: Hint['status'], text: string, ctx: GameContext) {
  round.hints.push({
    playerId: currentSpeaker(round)!,
    lap: Math.floor(round.turnIndex / round.order.length) + 1,
    text,
    status,
  })
  round.turnIndex++
  beginTurn(room, round, ctx)
}

/** 설명 검사에 쓸 "본인 제시어" (라이어 모드의 라이어는 제시어가 없으므로 검사하지 않음) */
function ownWord(round: Round, playerId: string): Word | null {
  if (playerId !== round.liarId) return round.citizenWord
  return round.mode === 'fool' ? round.liarWord : null
}

export function submitHint(room: Room, playerId: string, rawText: unknown, turnIndex: unknown, ctx: GameContext): Result {
  const round = room.round
  if (room.phase !== 'DESCRIBE' || !round) return fail('WRONG_PHASE')
  if (currentSpeaker(round) !== playerId) return fail('NOT_YOUR_TURN')
  if (turnIndex !== round.turnIndex) return fail('STALE')
  if (typeof rawText !== 'string') return fail('INVALID')
  const text = cleanText(rawText)
  const len = textLength(text)
  if (len < LIMITS.hint.min || len > LIMITS.hint.max || !normalize(text)) return fail('INVALID')
  const word = ownWord(round, playerId)
  if (word && hintRevealsWord(text, word.keys)) return fail('CONTAINS_WORD')
  advanceTurn(room, round, 'ok', text, ctx)
  return ok()
}

// ── DISCUSS ──────────────────────────────────────────────────

function startDiscuss(room: Room, round: Round, ctx: GameContext) {
  round.ready = new Set()
  setPhase(room, 'DISCUSS', room.settings.discussSeconds * 1000, ctx)
}

export function setReady(room: Room, playerId: string, ready: unknown, ctx: GameContext): Result {
  const round = room.round
  if (room.phase !== 'DISCUSS' || !round) return fail('WRONG_PHASE')
  if (!isActive(round, playerId)) return fail('NOT_ALLOWED')
  if (typeof ready !== 'boolean') return fail('INVALID')
  if (ready) round.ready.add(playerId)
  else round.ready.delete(playerId)
  checkAllReady(room, round, ctx)
  return ok()
}

function checkAllReady(room: Room, round: Round, ctx: GameContext) {
  const waiting = connectedActive(room, round)
  if (waiting.length > 0 && waiting.every((id) => round.ready.has(id))) startVote(room, round, 1, activeIds(round), null, ctx)
}

// ── VOTE ─────────────────────────────────────────────────────

function startVote(
  room: Room,
  round: Round,
  voteRound: 1 | 2,
  candidates: string[],
  prevTally: Record<string, number> | null,
  ctx: GameContext,
) {
  round.vote = { round: voteRound, candidates, votes: new Map(), prevTally }
  setPhase(room, 'VOTE', voteRound === 1 ? TIMINGS.voteFirst : TIMINGS.voteSecond, ctx)
}

export function castVote(room: Room, playerId: string, targetId: unknown, voteRound: unknown, ctx: GameContext): Result {
  const round = room.round
  if (room.phase !== 'VOTE' || !round?.vote) return fail('WRONG_PHASE')
  if (!isActive(round, playerId)) return fail('NOT_ALLOWED')
  const vote = round.vote
  if (voteRound !== vote.round) return fail('STALE')
  if (typeof targetId !== 'string' || targetId === playerId || !vote.candidates.includes(targetId)) return fail('INVALID')
  vote.votes.set(playerId, targetId)
  checkAllVoted(room, round, ctx)
  return ok()
}

function checkAllVoted(room: Room, round: Round, ctx: GameContext) {
  const vote = round.vote
  if (!vote) return
  const waiting = connectedActive(room, round)
  if (waiting.length > 0 && waiting.every((id) => vote.votes.has(id))) resolveVote(room, round, ctx)
}

function resolveVote(room: Room, round: Round, ctx: GameContext) {
  const vote = round.vote!
  for (const [voterId, targetId] of vote.votes) round.voteHistory.push({ voterId, targetId, round: vote.round })

  if (vote.round === 2 && vote.candidates.length === 1) return accuse(room, round, vote.candidates[0]!, ctx)
  if (vote.candidates.length === 0 || vote.votes.size === 0) return finish(room, round, 'liar', 'no_votes', ctx)

  const tally: Record<string, number> = {}
  for (const id of vote.candidates) tally[id] = 0
  for (const target of vote.votes.values()) if (target in tally) tally[target]!++
  const max = Math.max(...Object.values(tally))
  const top = vote.candidates.filter((id) => tally[id] === max)

  if (top.length === 1) return accuse(room, round, top[0]!, ctx)
  if (vote.round === 1) return startVote(room, round, 2, top, tally, ctx)
  return finish(room, round, 'liar', 'tie', ctx)
}

function accuse(room: Room, round: Round, accusedId: string, ctx: GameContext) {
  round.accusedId = accusedId
  round.vote = null
  if (accusedId !== round.liarId) return finish(room, round, 'liar', 'wrong_accusation', ctx)
  const liarConnected = room.players.get(round.liarId)?.connected ?? false
  setPhase(room, 'LIAR_GUESS', liarConnected ? TIMINGS.liarGuess : TIMINGS.liarGuessDisconnected, ctx)
}

// ── LIAR_GUESS / GUESS_JUDGE ─────────────────────────────────

export function submitGuess(room: Room, playerId: string, rawText: unknown, ctx: GameContext): Result {
  const round = room.round
  if (room.phase !== 'LIAR_GUESS' || !round) return fail('WRONG_PHASE')
  if (playerId !== round.liarId) return fail('NOT_ALLOWED')
  if (typeof rawText !== 'string') return fail('INVALID')
  const text = cleanText(rawText)
  const len = textLength(text)
  if (len < LIMITS.guess.min || len > LIMITS.guess.max) return fail('INVALID')
  processGuess(room, round, text, ctx)
  return ok()
}

function processGuess(room: Room, round: Round, text: string, ctx: GameContext) {
  const result = judgeGuess(text, round.citizenWord, round.category)
  round.guess = text
  round.guessResult = result
  if (result.verdict !== 'ask') return concludeGuess(room, round, result.verdict === 'accept', 'rule', false, ctx)
  if (room.settings.judgeMode === 'auto') return concludeGuess(room, round, result.autoVerdict === 'accept', 'auto', false, ctx)
  startGuessJudge(room, round, room.settings.judgeMode, ctx)
}

function startGuessJudge(room: Room, round: Round, method: 'host' | 'vote', ctx: GameContext) {
  const host = room.players.get(room.hostId)
  if (method === 'host' && host?.connected && room.hostId !== round.liarId) {
    round.judge = { method: 'host', judgeIds: [room.hostId], votes: new Map() }
    setPhase(room, 'GUESS_JUDGE', TIMINGS.guessJudge, ctx)
    return
  }
  const judges = connectedActive(room, round).filter((id) => id !== round.liarId)
  if (judges.length === 0) {
    return concludeGuess(room, round, round.guessResult!.autoVerdict === 'accept', 'auto', false, ctx)
  }
  round.judge = { method: 'vote', judgeIds: judges, votes: new Map() }
  setPhase(room, 'GUESS_JUDGE', TIMINGS.guessJudge, ctx)
}

export function judgeDecision(room: Room, playerId: string, accept: unknown, ctx: GameContext): Result {
  const round = room.round
  const judge = round?.judge
  if (room.phase !== 'GUESS_JUDGE' || !round || !judge) return fail('WRONG_PHASE')
  if (!judge.judgeIds.includes(playerId)) return fail('NOT_ALLOWED')
  if (typeof accept !== 'boolean') return fail('INVALID')
  if (judge.method === 'host') {
    if (playerId !== room.hostId) return fail('NOT_ALLOWED')
    round.judgeVotes = [{ judgeId: playerId, accept }]
    concludeGuess(room, round, accept, 'host', false, ctx)
    return ok()
  }
  judge.votes.set(playerId, accept)
  checkJudgeVotes(room, round, ctx)
  return ok()
}

function checkJudgeVotes(room: Room, round: Round, ctx: GameContext) {
  const judge = round.judge!
  const waiting = judge.judgeIds.filter((id) => room.players.get(id)?.connected && !round.left.has(id))
  if (waiting.length === 0 || waiting.every((id) => judge.votes.has(id))) resolveJudgeVote(room, round, ctx)
}

function resolveJudgeVote(room: Room, round: Round, ctx: GameContext) {
  const judge = round.judge!
  round.judgeVotes = [...judge.votes].map(([judgeId, accept]) => ({ judgeId, accept }))
  const yes = round.judgeVotes.filter((v) => v.accept).length
  const no = round.judgeVotes.length - yes
  if (yes === no) {
    // 동률이거나 아무도 투표하지 않음 → 자동 판정 제안을 따른다
    const accepted = round.guessResult!.autoVerdict === 'accept'
    return concludeGuess(room, round, accepted, 'vote', round.judgeVotes.length === 0, ctx)
  }
  concludeGuess(room, round, yes > no, 'vote', false, ctx)
}

function concludeGuess(
  room: Room,
  round: Round,
  accepted: boolean,
  method: JudgementView['method'],
  timedOut: boolean,
  ctx: GameContext,
) {
  const result = round.guessResult!
  round.judgement = {
    guess: round.guess ?? '',
    accepted,
    method,
    reason: result.reason,
    similarity: result.similarity,
    timedOut,
  }
  if ((method === 'host' || method === 'vote') && !timedOut) {
    room.effects.push({
      type: 'judgement-log',
      entry: {
        at: new Date(ctx.now).toISOString(),
        room: room.code,
        categoryId: round.category.id,
        category: round.category.name,
        word: round.citizenWord.text,
        guess: round.judgement.guess,
        accepted,
        method,
        similarity: Math.round(result.similarity * 1000) / 1000,
      },
    })
  }
  finish(room, round, accepted ? 'liar' : 'citizens', accepted ? 'guessed' : 'guess_failed', ctx)
}

// ── 결과 ──────────────────────────────────────────────────────

function finish(room: Room, round: Round, winner: Round['winner'], reason: ResultReason, ctx: GameContext) {
  round.winner = winner
  round.reason = reason
  round.vote = null
  const delta: Record<string, number> = {}
  switch (reason) {
    case 'wrong_accusation':
    case 'tie':
    case 'no_votes':
      delta[round.liarId] = SCORE.liarEscaped
      break
    case 'guessed':
      delta[round.liarId] = SCORE.liarGuessed
      break
    case 'guess_failed':
    case 'liar_left':
      for (const id of activeIds(round)) if (id !== round.liarId) delta[id] = SCORE.citizenWin
      break
    case 'aborted':
      break
  }
  round.scoreDelta = delta
  for (const [id, d] of Object.entries(delta)) {
    if (room.scores.has(id)) room.scores.set(id, room.scores.get(id)! + d)
  }
  setPhase(room, 'RESULT', null, ctx)
}

export function abortRound(room: Room, actorId: string, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  if (!isRoundActive(room) || !room.round) return fail('WRONG_PHASE')
  systemChat(room, '방장이 라운드를 중단했어요.', ctx)
  finish(room, room.round, null, 'aborted', ctx)
  return ok()
}

export function backToLobby(room: Room, actorId: string, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  if (room.phase !== 'RESULT') return fail('WRONG_PHASE')
  room.round = null
  setPhase(room, 'LOBBY', null, ctx)
  return ok()
}

/** 방장이 다음 단계로 넘기기 (제시어 확인 / 설명 차례 / 토론) */
export function skipPhase(room: Room, actorId: string, ctx: GameContext): Result {
  if (actorId !== room.hostId) return fail('NOT_HOST')
  const round = room.round
  if (!round) return fail('WRONG_PHASE')
  switch (room.phase) {
    case 'ROLE_REVEAL':
      startDescribe(room, round, ctx)
      return ok()
    case 'DESCRIBE':
      advanceTurn(room, round, 'skipped', '', ctx)
      return ok()
    case 'DISCUSS':
      startVote(room, round, 1, activeIds(round), null, ctx)
      return ok()
    default:
      return fail('WRONG_PHASE')
  }
}

// ── 참가자가 라운드 도중 나갔을 때 ─────────────────────────────

function handleParticipantLeft(room: Room, round: Round, playerId: string, ctx: GameContext) {
  if (playerId === round.liarId) {
    if (room.phase === 'LIAR_GUESS' || room.phase === 'GUESS_JUDGE') {
      // 검거된 라이어가 나가면 정답 도전 실패로 처리
      return finish(room, round, 'citizens', 'liar_left', ctx)
    }
    systemChat(room, '라이어가 나가서 라운드가 중단되었어요.', ctx)
    return finish(room, round, null, 'aborted', ctx)
  }
  if (activeIds(round).length < LIMITS.minPlayers) {
    systemChat(room, `참가자가 ${LIMITS.minPlayers}명 미만이 되어 라운드가 중단되었어요.`, ctx)
    return finish(room, round, null, 'aborted', ctx)
  }
  switch (room.phase) {
    case 'ROLE_REVEAL':
      round.confirmed.delete(playerId)
      return checkAllConfirmed(room, round, ctx)
    case 'DESCRIBE':
      if (currentSpeaker(round) === playerId) advanceTurn(room, round, 'skipped', '', ctx)
      return
    case 'DISCUSS':
      round.ready.delete(playerId)
      return checkAllReady(room, round, ctx)
    case 'VOTE': {
      const vote = round.vote!
      vote.votes.delete(playerId)
      // 나간 사람에게 투표한 사람은 다시 투표할 수 있다
      for (const [voter, target] of [...vote.votes]) if (target === playerId) vote.votes.delete(voter)
      vote.candidates = vote.candidates.filter((id) => id !== playerId)
      if (vote.round === 2 && vote.candidates.length <= 1) return resolveVote(room, round, ctx)
      return checkAllVoted(room, round, ctx)
    }
    case 'GUESS_JUDGE': {
      const judge = round.judge!
      if (judge.method === 'vote') {
        judge.judgeIds = judge.judgeIds.filter((id) => id !== playerId)
        judge.votes.delete(playerId)
        checkJudgeVotes(room, round, ctx)
      }
      return
    }
  }
}

// ── 시간 흐름 ──────────────────────────────────────────────────

function onPhaseTimeout(room: Room, round: Round, ctx: GameContext) {
  switch (room.phase) {
    case 'ROLE_REVEAL':
      return startDescribe(room, round, ctx)
    case 'DESCRIBE':
      return advanceTurn(room, round, 'timeout', '', ctx)
    case 'DISCUSS':
      return startVote(room, round, 1, activeIds(round), null, ctx)
    case 'VOTE':
      return resolveVote(room, round, ctx)
    case 'LIAR_GUESS':
      return processGuess(room, round, '', ctx)
    case 'GUESS_JUDGE':
      if (round.judge?.method === 'host') {
        return concludeGuess(room, round, round.guessResult!.autoVerdict === 'accept', 'host', true, ctx)
      }
      return resolveJudgeVote(room, round, ctx)
  }
}

function hostTransferCandidate(room: Room): Player | undefined {
  return playersByJoin(room).find((p) => p.connected && p.id !== room.hostId)
}

/** 시간이 지나 처리할 일이 있으면 처리한다. socket.ts가 nextDeadline() 시각에 호출. */
export function tick(room: Room, ctx: GameContext): void {
  // 방장이 오래 끊겨 있으면 입장 순서상 다음 사람에게 넘긴다 (역할과 무관 → 라이어 정보 누출 없음)
  const host = room.players.get(room.hostId)
  if (host && !host.connected && host.disconnectedAt !== null && ctx.now - host.disconnectedAt >= TIMINGS.hostTransferDelay) {
    const next = hostTransferCandidate(room)
    if (next) setHost(room, next.id, ctx)
  }

  if (!isRoundActive(room)) {
    for (const p of [...room.players.values()]) {
      if (!p.connected && p.disconnectedAt !== null && ctx.now - p.disconnectedAt >= TIMINGS.idleRemoveDelay) {
        removePlayer(room, p.id, 'idle', ctx)
      }
    }
  }

  for (let guard = 0; guard < 100; guard++) {
    if (room.phaseEndsAt === null || ctx.now < room.phaseEndsAt || !room.round) break
    onPhaseTimeout(room, room.round, ctx)
  }
}

/** 다음에 tick()을 불러야 하는 시각 (없으면 null) */
export function nextDeadline(room: Room): number | null {
  const times: number[] = []
  if (room.phaseEndsAt !== null && room.round) times.push(room.phaseEndsAt)
  const host = room.players.get(room.hostId)
  if (host && !host.connected && host.disconnectedAt !== null && hostTransferCandidate(room)) {
    times.push(host.disconnectedAt + TIMINGS.hostTransferDelay)
  }
  if (!isRoundActive(room)) {
    for (const p of room.players.values()) {
      if (!p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + TIMINGS.idleRemoveDelay)
    }
  }
  return times.length > 0 ? Math.min(...times) : null
}

// ── 플레이어별 화면 정보 ──────────────────────────────────────

function secretFor(round: Round, playerId: string): Secret {
  if (!round.participants.includes(playerId)) return { kind: 'none' }
  if (round.mode === 'liar') {
    return playerId === round.liarId ? { kind: 'liar' } : { kind: 'word', word: round.citizenWord.text }
  }
  // 바보 모드: 모두 같은 모양의 정보를 받는다 (라이어도 자신이 라이어인지 모름)
  const word = playerId === round.liarId ? round.liarWord! : round.citizenWord
  return { kind: 'word', word: word.text }
}

function roundView(room: Room, round: Round, me: string): RoundView {
  const phase = room.phase
  const n = round.order.length
  const total = totalTurns(room, round)
  const vote = round.vote
  const judge = round.judge
  // 판정 화면의 정답: 시민 참가자와 (라이어가 아닌) 방장만 볼 수 있다
  const knowsAnswer = me !== round.liarId && (isActive(round, me) || me === room.hostId)

  return {
    no: round.no,
    mode: round.mode,
    categoryName: round.category.name,
    categoryIcon: round.category.icon,
    order: round.order,
    names: round.names,
    left: [...round.left],
    secret: secretFor(round, me),
    confirmed: [...round.confirmed],
    turn:
      phase === 'DESCRIBE'
        ? {
            index: round.turnIndex,
            total,
            lap: Math.floor(round.turnIndex / n) + 1,
            laps: room.settings.laps,
            playerId: currentSpeaker(round),
          }
        : null,
    hints: round.hints.map((h) => ({ ...h })),
    ready: phase === 'DISCUSS' ? [...round.ready] : [],
    vote:
      phase === 'VOTE' && vote
        ? {
            round: vote.round,
            candidates: vote.candidates,
            voted: [...vote.votes.keys()],
            myVote: vote.votes.get(me) ?? null,
            prevTally: vote.prevTally,
          }
        : null,
    accusedId: round.accusedId,
    guess: phase === 'GUESS_JUDGE' || phase === 'RESULT' ? round.guess : null,
    judge:
      phase === 'GUESS_JUDGE' && judge
        ? {
            method: judge.method,
            judgeIds: judge.judgeIds,
            voted: [...judge.votes.keys()],
            myVote: judge.votes.get(me) ?? null,
            answer: knowsAnswer ? round.citizenWord.text : null,
            similarity: round.guessResult?.similarity ?? 0,
            suggestion: round.guessResult?.autoVerdict ?? 'reject',
          }
        : null,
    result:
      phase === 'RESULT' && round.reason
        ? {
            winner: round.winner,
            reason: round.reason,
            liarId: round.liarId,
            citizenWord: round.citizenWord.text,
            liarWord: round.liarWord?.text ?? null,
            accusedId: round.accusedId,
            votes: round.voteHistory,
            judgement: round.judgement,
            judgeVotes: round.judgeVotes,
            scoreDelta: round.scoreDelta,
          }
        : null,
  }
}

function capabilities(room: Room, me: string): Capabilities {
  const round = room.round
  const isHost = me === room.hostId
  const phase = room.phase
  const active = !!round && isActive(round, me)
  const connectedCount = [...room.players.values()].filter((p) => p.connected).length
  const judge = round?.judge
  return {
    start: isHost && !isRoundActive(room) && connectedCount >= LIMITS.minPlayers,
    settings: isHost && !isRoundActive(room),
    confirm: phase === 'ROLE_REVEAL' && active && !round!.confirmed.has(me),
    hint: phase === 'DESCRIBE' && !!round && currentSpeaker(round) === me,
    ready: phase === 'DISCUSS' && active,
    vote: phase === 'VOTE' && active,
    guess: phase === 'LIAR_GUESS' && round?.liarId === me,
    judge:
      phase === 'GUESS_JUDGE' &&
      !!judge &&
      judge.judgeIds.includes(me) &&
      (judge.method === 'vote' || me === room.hostId),
    skip: isHost && (phase === 'ROLE_REVEAL' || phase === 'DESCRIBE' || phase === 'DISCUSS'),
    abort: isHost && isRoundActive(room),
    toLobby: isHost && phase === 'RESULT',
    chat: canChat(room, me),
    kick: isHost && !isRoundActive(room),
  }
}

export function viewFor(room: Room, playerId: string, ctx: GameContext): RoomView {
  const me = room.players.get(playerId)!
  const round = room.round
  const participant = (id: string) => !!round && isActive(round, id)
  return {
    now: ctx.now,
    me: { id: me.id, name: me.name, isHost: me.id === room.hostId, isParticipant: participant(me.id) },
    room: {
      code: room.code,
      name: room.name,
      isPrivate: room.isPrivate,
      hasPassword: room.passwordHash !== null,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      phase: room.phase,
      phaseEndsAt: room.phaseEndsAt,
      settings: { ...room.settings, categoryIds: [...room.settings.categoryIds] },
      players: playersByJoin(room).map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        score: room.scores.get(p.id) ?? 0,
        isHost: p.id === room.hostId,
        isParticipant: participant(p.id),
      })),
      categories: ctx.words.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, wordCount: c.words.length })),
    },
    chat: room.chat,
    round: round ? roundView(room, round, playerId) : null,
    can: capabilities(room, playerId),
  }
}
