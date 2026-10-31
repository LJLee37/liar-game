import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { LIMITS, TIMINGS } from '../shared/constants.ts'
import type { RoomView } from '../shared/protocol.ts'
import {
  abortRound,
  addPlayer,
  backToLobby,
  castVote,
  confirmRole,
  createRoom,
  judgeDecision,
  kick,
  nextDeadline,
  removePlayer,
  resetScores,
  sendChat,
  setConnected,
  setReady,
  skipPhase,
  startGame,
  submitGuess,
  submitHint,
  tick,
  transferHost,
  updateSettings,
  viewFor,
} from './game.ts'
import type { GameContext, Room } from './game.ts'
import { seededRng } from './util.ts'
import { loadWords } from './words/load.ts'

const bank = loadWords(fileURLToPath(new URL('../test/fixtures/words-mini', import.meta.url))).bank

function setup(players = 4, seed = 1) {
  const ctx: GameContext = { now: 1_000_000, rng: seededRng(seed), words: bank }
  const created = createRoom(
    { code: 'ABCD', name: '테스트 방', isPrivate: false, passwordHash: null, maxPlayers: 8, hostName: 'P0' },
    ctx,
  )
  if (!created.ok) throw new Error(created.error)
  const room = created.room
  const ids = [created.player.id]
  for (let i = 1; i < players; i++) {
    const r = addPlayer(room, `P${i}`, ctx)
    if (!r.ok) throw new Error(r.error)
    ids.push(r.player.id)
  }
  const advance = (ms: number) => {
    ctx.now += ms
    tick(room, ctx)
  }
  return { room, ctx, ids, host: ids[0]!, advance }
}

/** 테스트를 결정적으로 만들기 위해 라이어를 지정한다 (화이트박스) */
function forceLiar(room: Room, id: string) {
  const round = room.round!
  if (round.mode === 'fool' && round.liarId !== id) {
    // 바보 모드에서는 라이어 단어도 함께 유지된다
  }
  round.liarId = id
}

function confirmAll(room: Room, ctx: GameContext) {
  for (const id of room.round!.participants) confirmRole(room, id, ctx)
}

function describeAll(room: Room, ctx: GameContext) {
  let guard = 0
  while (room.phase === 'DESCRIBE' && guard++ < 100) {
    const round = room.round!
    const speaker = round.order[round.turnIndex % round.order.length]!
    const r = submitHint(room, speaker, `설명 ${round.turnIndex}`, round.turnIndex, ctx)
    expect(r).toEqual({ ok: true })
  }
}

function readyAll(room: Room, ctx: GameContext) {
  for (const id of room.round!.participants) setReady(room, id, true, ctx)
}

/** 모두 target에게 투표 (target 본인은 다른 사람에게) */
function voteFor(room: Room, target: string, ctx: GameContext) {
  const vote = room.round!.vote!
  for (const id of room.round!.participants) {
    if (room.round!.left.has(id)) continue
    const to = id === target ? vote.candidates.find((c) => c !== id)! : target
    castVote(room, id, to, vote.round, ctx)
  }
}

function toVote(room: Room, ctx: GameContext) {
  confirmAll(room, ctx)
  describeAll(room, ctx)
  readyAll(room, ctx)
  expect(room.phase).toBe('VOTE')
}

describe('게임 시작', () => {
  it('3명 미만이면 시작할 수 없다', () => {
    const { room, ctx, host } = setup(2)
    expect(startGame(room, host, ctx)).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' })
  })

  it('방장만 시작할 수 있다', () => {
    const { room, ctx, ids } = setup(3)
    expect(startGame(room, ids[1]!, ctx)).toEqual({ ok: false, error: 'NOT_HOST' })
  })

  it('라이어 모드: 라이어는 카테고리만, 시민은 같은 제시어를 받는다', () => {
    const { room, ctx, ids, host } = setup(4)
    expect(startGame(room, host, ctx).ok).toBe(true)
    expect(room.phase).toBe('ROLE_REVEAL')
    const round = room.round!
    for (const id of ids) {
      const v = viewFor(room, id, ctx)
      if (id === round.liarId) expect(v.round!.secret).toEqual({ kind: 'liar' })
      else expect(v.round!.secret).toEqual({ kind: 'word', word: round.citizenWord.text })
      expect(v.round!.categoryName).toBe(round.category.name)
    }
  })

  it('바보 모드: 라이어는 같은 소분류의 다른 단어를 받는다', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { room, ctx, ids, host } = setup(4, seed)
      updateSettings(room, host, { mode: 'fool', categoryIds: ['food'] }, ctx)
      startGame(room, host, ctx)
      const round = room.round!
      expect(round.liarWord).not.toBeNull()
      expect(round.liarWord!.text).not.toBe(round.citizenWord.text)
      expect(round.liarWord!.group).toBe(round.citizenWord.group)
      for (const id of ids) {
        const secret = viewFor(room, id, ctx).round!.secret
        const expected = id === round.liarId ? round.liarWord!.text : round.citizenWord.text
        expect(secret).toEqual({ kind: 'word', word: expected })
      }
    }
  })

  it('같은 방에서는 단어를 모두 쓰기 전까지 반복 출제하지 않는다', () => {
    const { room, ctx, host } = setup(3)
    updateSettings(room, host, { categoryIds: ['food'] }, ctx)
    const seen = new Set<string>()
    for (let i = 0; i < 5; i++) {
      startGame(room, host, ctx)
      seen.add(room.round!.citizenWord.text)
      abortRound(room, host, ctx)
    }
    expect(seen.size).toBe(5)
  })
})

describe('라운드 진행', () => {
  it('라이어 모드 전체 흐름: 검거 후 별칭으로 정답 → 라이어 +1', () => {
    const { room, ctx, ids, host } = setup(4)
    updateSettings(room, host, { categoryIds: ['food'], laps: 2 }, ctx)
    startGame(room, host, ctx)
    const liar = ids[2]!
    forceLiar(room, liar)
    confirmAll(room, ctx)
    expect(room.phase).toBe('DESCRIBE')

    // 차례가 아닌 사람, 오래된 차례 번호
    const round = room.round!
    const speaker = round.order[0]!
    const other = round.order[1]!
    expect(submitHint(room, other, '설명', 0, ctx)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' })
    expect(submitHint(room, speaker, '설명', 3, ctx)).toEqual({ ok: false, error: 'STALE' })

    describeAll(room, ctx)
    expect(round.hints).toHaveLength(8)
    expect(room.phase).toBe('DISCUSS')
    readyAll(room, ctx)
    expect(room.phase).toBe('VOTE')

    voteFor(room, liar, ctx)
    expect(room.phase).toBe('LIAR_GUESS')
    expect(viewFor(room, ids[0]!, ctx).round!.accusedId).toBe(liar)
    expect(submitGuess(room, ids[0]!, '아무거나', ctx)).toEqual({ ok: false, error: 'NOT_ALLOWED' })

    const answer = round.citizenWord
    submitGuess(room, liar, answer.aliases[0] ?? answer.text, ctx)
    expect(room.phase).toBe('RESULT')
    const result = viewFor(room, ids[0]!, ctx).round!.result!
    expect(result).toMatchObject({ winner: 'liar', reason: 'guessed', liarId: liar, citizenWord: answer.text })
    expect(room.scores.get(liar)).toBe(1)
  })

  it('검거 후 오답이면 시민 각자 +1', () => {
    const { room, ctx, ids, host } = setup(4)
    updateSettings(room, host, { categoryIds: ['fruit'], judgeMode: 'auto' }, ctx)
    startGame(room, host, ctx)
    const liar = ids[1]!
    forceLiar(room, liar)
    toVote(room, ctx)
    voteFor(room, liar, ctx)
    submitGuess(room, liar, '수박', ctx)
    expect(room.round!.reason).toBe('guess_failed')
    expect(room.round!.winner).toBe('citizens')
    for (const id of ids) expect(room.scores.get(id)).toBe(id === liar ? 0 : 1)
  })

  it('바보 모드: 시민을 지목하면 라이어 +2', () => {
    const { room, ctx, ids, host } = setup(4)
    updateSettings(room, host, { mode: 'fool' }, ctx)
    startGame(room, host, ctx)
    const liar = room.round!.liarId
    const innocent = ids.find((id) => id !== liar)!
    toVote(room, ctx)
    voteFor(room, innocent, ctx)
    expect(room.round!.reason).toBe('wrong_accusation')
    expect(room.scores.get(liar)).toBe(2)
  })

  it('설명에 자기 제시어를 쓰면 거부 (라이어 모드 라이어는 검사 안 함)', () => {
    const { room, ctx, ids, host } = setup(3)
    updateSettings(room, host, { categoryIds: ['food'] }, ctx)
    startGame(room, host, ctx)
    const round = room.round!
    confirmAll(room, ctx)
    const word = round.citizenWord.text
    // 첫 차례가 시민이 되도록 라이어를 정한다
    const first = round.order[0]!
    forceLiar(room, ids.find((id) => id !== first)!)
    expect(submitHint(room, first, `맛있는 ${word}`, 0, ctx)).toEqual({ ok: false, error: 'CONTAINS_WORD' })
    expect(submitHint(room, first, '맛있는 음식', 0, ctx).ok).toBe(true)
    const second = round.order[1]!
    forceLiar(room, second)
    expect(submitHint(room, second, `${word} 아닐까`, 1, ctx).ok).toBe(true)
  })

  it('동률이면 재투표, 또 동률이면 라이어 승리', () => {
    const { room, ctx, ids, host } = setup(4)
    startGame(room, host, ctx)
    const [a, b, c, d] = ids as [string, string, string, string]
    forceLiar(room, d)
    toVote(room, ctx)
    castVote(room, a, b, 1, ctx)
    castVote(room, b, a, 1, ctx)
    castVote(room, c, a, 1, ctx)
    castVote(room, d, b, 1, ctx)
    expect(room.phase).toBe('VOTE')
    const v = viewFor(room, a, ctx).round!.vote!
    expect(v.round).toBe(2)
    expect(v.candidates.sort()).toEqual([a, b].sort())
    expect(v.prevTally).toMatchObject({ [a]: 2, [b]: 2 })
    expect(castVote(room, c, d, 2, ctx)).toEqual({ ok: false, error: 'INVALID' })
    expect(castVote(room, c, a, 1, ctx)).toEqual({ ok: false, error: 'STALE' })
    castVote(room, a, b, 2, ctx)
    castVote(room, b, a, 2, ctx)
    castVote(room, c, a, 2, ctx)
    castVote(room, d, b, 2, ctx)
    expect(room.round!.reason).toBe('tie')
    expect(room.scores.get(d)).toBe(2)
  })

  it('자기 자신에게는 투표할 수 없다', () => {
    const { room, ctx, ids, host } = setup(3)
    startGame(room, host, ctx)
    toVote(room, ctx)
    expect(castVote(room, ids[0]!, ids[0]!, 1, ctx)).toEqual({ ok: false, error: 'INVALID' })
  })
})

describe('시간 초과', () => {
  it('각 단계가 시간 초과로 진행된다', () => {
    const { room, ctx, ids, host, advance } = setup(3)
    updateSettings(room, host, { hintSeconds: 15, discussSeconds: 30 }, ctx)
    startGame(room, host, ctx)
    forceLiar(room, ids[1]!)
    advance(TIMINGS.roleReveal)
    expect(room.phase).toBe('DESCRIBE')
    for (let i = 0; i < 3; i++) advance(15_000)
    expect(room.round!.hints.map((h) => h.status)).toEqual(['timeout', 'timeout', 'timeout'])
    expect(room.phase).toBe('DISCUSS')
    advance(30_000)
    expect(room.phase).toBe('VOTE')
    advance(TIMINGS.voteFirst)
    expect(room.round!.reason).toBe('no_votes')
  })

  it('라이어가 시간 안에 답하지 않으면 시민 승리', () => {
    const { room, ctx, ids, host, advance } = setup(3)
    startGame(room, host, ctx)
    forceLiar(room, ids[2]!)
    toVote(room, ctx)
    voteFor(room, ids[2]!, ctx)
    advance(TIMINGS.liarGuess)
    expect(room.round!.judgement).toMatchObject({ accepted: false, reason: 'empty' })
    expect(room.round!.winner).toBe('citizens')
  })

  it('nextDeadline은 다음 처리 시각을 알려 준다', () => {
    const { room, ctx, host } = setup(3)
    expect(nextDeadline(room)).toBeNull()
    startGame(room, host, ctx)
    expect(nextDeadline(room)).toBe(ctx.now + TIMINGS.roleReveal)
  })
})

describe('정답 판정 방식', () => {
  function toGuess(judgeMode: 'auto' | 'host' | 'vote', players = 4, liarIndex = 3) {
    const t = setup(players)
    updateSettings(t.room, t.host, { categoryIds: ['food'], judgeMode }, t.ctx)
    startGame(t.room, t.host, t.ctx)
    const liar = t.ids[liarIndex]!
    forceLiar(t.room, liar)
    // 정답을 짜장면으로 고정
    const round = t.room.round!
    round.citizenWord = round.category.words.find((w) => w.text === '짜장면')!
    toVote(t.room, t.ctx)
    voteFor(t.room, liar, t.ctx)
    return { ...t, liar }
  }

  it('애매한 답(짜장)은 방장이 판정하고 기록을 남긴다', () => {
    const { room, ctx, ids, host, liar } = toGuess('host')
    submitGuess(room, liar, '짜장', ctx)
    expect(room.phase).toBe('GUESS_JUDGE')
    const hostView = viewFor(room, host, ctx).round!.judge!
    expect(hostView).toMatchObject({ method: 'host', answer: '짜장면', suggestion: 'reject' })
    expect(viewFor(room, liar, ctx).round!.judge!.answer).toBeNull()
    expect(viewFor(room, ids[1]!, ctx).can.judge).toBe(false)
    expect(judgeDecision(room, ids[1]!, true, ctx)).toEqual({ ok: false, error: 'NOT_ALLOWED' })
    room.effects = []
    judgeDecision(room, host, true, ctx)
    expect(room.round!.reason).toBe('guessed')
    expect(room.effects).toContainEqual(
      expect.objectContaining({
        type: 'judgement-log',
        entry: expect.objectContaining({ word: '짜장면', guess: '짜장', accepted: true, method: 'host' }),
      }),
    )
  })

  it('방장이 시간 안에 판정하지 않으면 자동 판정 제안을 따른다', () => {
    const { room, ctx, liar, advance } = toGuess('host')
    submitGuess(room, liar, '짜장', ctx)
    advance(TIMINGS.guessJudge)
    expect(room.round!.judgement).toMatchObject({ accepted: false, method: 'host', timedOut: true })
  })

  it('방장이 라이어면 플레이어 투표로 전환', () => {
    const { room, ctx, liar } = toGuess('host', 4, 0)
    submitGuess(room, liar, '짜장', ctx)
    expect(room.round!.judge!.method).toBe('vote')
    expect(room.round!.judge!.judgeIds).not.toContain(liar)
  })

  it('플레이어 투표: 과반이면 인정, 동률이면 자동 판정', () => {
    const { room, ctx, ids, liar } = toGuess('vote')
    submitGuess(room, liar, '짜장', ctx)
    expect(room.round!.judge!.judgeIds.sort()).toEqual(ids.filter((id) => id !== liar).sort())
    judgeDecision(room, ids[0]!, true, ctx)
    judgeDecision(room, ids[1]!, true, ctx)
    judgeDecision(room, ids[2]!, false, ctx)
    expect(room.round!.judgement).toMatchObject({ accepted: true, method: 'vote' })
    expect(viewFor(room, liar, ctx).round!.result!.judgeVotes).toHaveLength(3)
  })

  it('플레이어 투표 동률 → 자동 판정 제안', () => {
    const { room, ctx, ids, liar } = toGuess('vote', 3, 2)
    submitGuess(room, liar, '짜장', ctx)
    judgeDecision(room, ids[0]!, true, ctx)
    judgeDecision(room, ids[1]!, false, ctx)
    expect(room.round!.judgement).toMatchObject({ accepted: false, method: 'vote', timedOut: false })
  })

  it('자동 판정: 오타는 인정, 다른 단어는 불인정', () => {
    const a = toGuess('auto')
    submitGuess(a.room, a.liar, '짜장묜', a.ctx)
    expect(a.room.round!.judgement).toMatchObject({ accepted: true, method: 'auto', reason: 'similar' })
    const b = toGuess('auto')
    submitGuess(b.room, b.liar, '짬뽕', b.ctx)
    expect(b.room.round!.judgement).toMatchObject({ accepted: false, method: 'rule', reason: 'other-word' })
  })
})

describe('접속 끊김·나가기', () => {
  it('설명 차례인 사람이 끊기면 남은 시간이 줄어든다', () => {
    const { room, ctx, host } = setup(3)
    startGame(room, host, ctx)
    confirmAll(room, ctx)
    const speaker = room.round!.order[0]!
    setConnected(room, speaker, false, ctx)
    expect(room.phaseEndsAt).toBe(ctx.now + TIMINGS.describeDisconnectGrace)
  })

  it('방장이 20초 이상 끊기면 입장 순서상 다음 사람이 방장이 된다', () => {
    const { room, ctx, ids, host, advance } = setup(3)
    setConnected(room, host, false, ctx)
    advance(TIMINGS.hostTransferDelay - 1)
    expect(room.hostId).toBe(host)
    advance(1)
    expect(room.hostId).toBe(ids[1])
  })

  it('대기실에서 90초 이상 끊긴 사람은 방에서 제거된다', () => {
    const { room, ctx, ids, advance } = setup(3)
    setConnected(room, ids[2]!, false, ctx)
    expect(nextDeadline(room)).toBe(ctx.now + TIMINGS.idleRemoveDelay)
    advance(TIMINGS.idleRemoveDelay)
    expect(room.players.has(ids[2]!)).toBe(false)
    expect(room.effects).toContainEqual({ type: 'removed', playerId: ids[2], reason: 'idle' })
  })

  it('투표 전에 라이어가 나가면 라운드 중단', () => {
    const { room, ctx, ids, host } = setup(4)
    startGame(room, host, ctx)
    forceLiar(room, ids[3]!)
    confirmAll(room, ctx)
    removePlayer(room, ids[3]!, 'leave', ctx)
    expect(room.round!.reason).toBe('aborted')
    expect(room.phase).toBe('RESULT')
  })

  it('검거된 라이어가 나가면 시민 승리', () => {
    const { room, ctx, ids, host } = setup(4)
    startGame(room, host, ctx)
    forceLiar(room, ids[3]!)
    toVote(room, ctx)
    voteFor(room, ids[3]!, ctx)
    removePlayer(room, ids[3]!, 'leave', ctx)
    expect(room.round).toMatchObject({ winner: 'citizens', reason: 'liar_left' })
    expect(room.scores.get(ids[0]!)).toBe(1)
  })

  it('참가자가 3명 미만이 되면 라운드 중단', () => {
    const { room, ctx, ids, host } = setup(3)
    startGame(room, host, ctx)
    forceLiar(room, ids[0]!)
    removePlayer(room, ids[2]!, 'leave', ctx)
    expect(room.round!.reason).toBe('aborted')
  })

  it('나간 사람의 설명 차례는 건너뛰고, 나간 사람에게 준 표는 취소된다', () => {
    const { room, ctx, ids, host } = setup(5)
    startGame(room, host, ctx)
    const leaver = ids[4]!
    forceLiar(room, ids[0]!)
    confirmAll(room, ctx)
    const round = room.round!
    if (round.order[0] !== leaver) {
      // 나갈 사람이 첫 차례가 되도록 순서를 바꾼다
      round.order = [leaver, ...round.order.filter((id) => id !== leaver)]
    }
    removePlayer(room, leaver, 'leave', ctx)
    expect(round.hints[0]).toMatchObject({ playerId: leaver, status: 'skipped' })
    describeAll(room, ctx)
    readyAll(room, ctx)
    const target = ids[3]!
    castVote(room, ids[1]!, target, 1, ctx)
    removePlayer(room, target, 'leave', ctx)
    expect(round.vote!.votes.has(ids[1]!)).toBe(false)
    expect(round.vote!.candidates).not.toContain(target)
  })

  it('방장이 나가면 즉시 다음 사람에게 방장이 넘어간다', () => {
    const { room, ctx, ids, host } = setup(3)
    removePlayer(room, host, 'leave', ctx)
    expect(room.hostId).toBe(ids[1])
  })

  it('라운드 도중 들어온 사람은 관전자', () => {
    const { room, ctx, host } = setup(3)
    startGame(room, host, ctx)
    const joined = addPlayer(room, '늦게온사람', ctx)
    if (!joined.ok) throw new Error()
    const v = viewFor(room, joined.player.id, ctx)
    expect(v.round!.secret).toEqual({ kind: 'none' })
    expect(v.me.isParticipant).toBe(false)
    confirmAll(room, ctx)
    describeAll(room, ctx)
    expect(sendChat(room, joined.player.id, '안녕', ctx)).toEqual({ ok: false, error: 'WRONG_PHASE' })
    abortRound(room, host, ctx)
    startGame(room, host, ctx)
    expect(room.round!.participants).toContain(joined.player.id)
  })
})

describe('방 관리', () => {
  it('닉네임 검증·중복·정원', () => {
    const { room, ctx } = setup(3)
    expect(addPlayer(room, '', ctx)).toEqual({ ok: false, error: 'NAME_INVALID' })
    expect(addPlayer(room, '긴'.repeat(LIMITS.playerName.max + 1), ctx)).toEqual({ ok: false, error: 'NAME_INVALID' })
    expect(addPlayer(room, ' p 1 ', ctx)).toEqual({ ok: false, error: 'NAME_TAKEN' })
    room.maxPlayers = 3
    expect(addPlayer(room, '새사람', ctx)).toEqual({ ok: false, error: 'ROOM_FULL' })
  })

  it('설정 검증', () => {
    const { room, ctx, ids, host } = setup(4)
    expect(updateSettings(room, ids[1]!, { laps: 2 }, ctx)).toEqual({ ok: false, error: 'NOT_HOST' })
    expect(updateSettings(room, host, { laps: 9 }, ctx)).toEqual({ ok: false, error: 'INVALID' })
    expect(updateSettings(room, host, { mode: 'x' as never }, ctx)).toEqual({ ok: false, error: 'INVALID' })
    expect(updateSettings(room, host, { maxPlayers: 3 }, ctx)).toEqual({ ok: false, error: 'INVALID' })
    expect(updateSettings(room, host, { categoryIds: ['food', 'nope'], laps: 3, maxPlayers: 6 }, ctx).ok).toBe(true)
    expect(room.settings.categoryIds).toEqual(['food'])
    expect(room.maxPlayers).toBe(6)
    startGame(room, host, ctx)
    expect(updateSettings(room, host, { laps: 1 }, ctx)).toEqual({ ok: false, error: 'WRONG_PHASE' })
  })

  it('강퇴·방장 위임·점수 초기화·대기실 복귀', () => {
    const { room, ctx, ids, host } = setup(4)
    expect(kick(room, ids[1]!, ids[2]!, ctx)).toEqual({ ok: false, error: 'NOT_HOST' })
    expect(kick(room, host, ids[3]!, ctx).ok).toBe(true)
    expect(room.players.has(ids[3]!)).toBe(false)
    expect(transferHost(room, host, ids[1]!, ctx).ok).toBe(true)
    expect(room.hostId).toBe(ids[1])
    room.scores.set(ids[2]!, 5)
    expect(resetScores(room, ids[1]!).ok).toBe(true)
    expect(room.scores.get(ids[2]!)).toBe(0)
    startGame(room, ids[1]!, ctx)
    expect(kick(room, ids[1]!, ids[2]!, ctx)).toEqual({ ok: false, error: 'WRONG_PHASE' })
    abortRound(room, ids[1]!, ctx)
    expect(backToLobby(room, ids[1]!, ctx).ok).toBe(true)
    expect(room.phase).toBe('LOBBY')
    expect(room.round).toBeNull()
  })

  it('방장 건너뛰기: 제시어 확인 → 설명 → 토론 → 투표', () => {
    const { room, ctx, host } = setup(3)
    startGame(room, host, ctx)
    skipPhase(room, host, ctx)
    expect(room.phase).toBe('DESCRIBE')
    skipPhase(room, host, ctx)
    expect(room.round!.hints[0]!.status).toBe('skipped')
    skipPhase(room, host, ctx)
    skipPhase(room, host, ctx)
    expect(room.phase).toBe('DISCUSS')
    skipPhase(room, host, ctx)
    expect(room.phase).toBe('VOTE')
    expect(skipPhase(room, host, ctx)).toEqual({ ok: false, error: 'WRONG_PHASE' })
  })

  it('채팅: 설명 중에는 막히고, 기록은 100개까지', () => {
    const { room, ctx, ids, host } = setup(3)
    for (let i = 0; i < 120; i++) sendChat(room, ids[i % 3]!, `메시지 ${i}`, ctx)
    expect(room.chat).toHaveLength(100)
    expect(sendChat(room, host, '', ctx)).toEqual({ ok: false, error: 'INVALID' })
    startGame(room, host, ctx)
    expect(sendChat(room, host, '안녕', ctx)).toEqual({ ok: false, error: 'WRONG_PHASE' })
  })
})

describe('정보 누출 방지', () => {
  /** 객체 구조(키와 값의 타입)만 뽑는다 */
  function shape(v: unknown): unknown {
    if (Array.isArray(v)) return v.length > 0 ? [shape(v[0])] : []
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, shape(x)]),
      )
    }
    return v === null ? 'null' : typeof v
  }

  function assertNoLeak(room: Room, ctx: GameContext, label: string) {
    const round = room.round!
    for (const id of room.players.keys()) {
      const json = JSON.stringify(viewFor(room, id, ctx))
      expect(json, `${label}: liarId`).not.toContain('"liarId"')
      if (id === round.liarId) {
        expect(json, `${label}: 라이어에게 시민 단어`).not.toContain(round.citizenWord.text)
      } else if (round.liarWord) {
        expect(json, `${label}: 시민에게 라이어 단어`).not.toContain(round.liarWord.text)
      }
    }
  }

  for (const mode of ['liar', 'fool'] as const) {
    it(`${mode} 모드: 결과 전까지 다른 단어와 라이어 정보가 없다`, () => {
      for (let seed = 1; seed <= 10; seed++) {
        const { room, ctx, host } = setup(4, seed)
        updateSettings(room, host, { mode, categoryIds: ['food'], judgeMode: 'host' }, ctx)
        startGame(room, host, ctx)
        assertNoLeak(room, ctx, 'ROLE_REVEAL')
        confirmAll(room, ctx)
        assertNoLeak(room, ctx, 'DESCRIBE')
        describeAll(room, ctx)
        assertNoLeak(room, ctx, 'DISCUSS')
        readyAll(room, ctx)
        assertNoLeak(room, ctx, 'VOTE')
        voteFor(room, room.round!.liarId, ctx)
        assertNoLeak(room, ctx, 'LIAR_GUESS')
        submitGuess(room, room.round!.liarId, '모르겠다', ctx)
        if (room.phase === 'GUESS_JUDGE') assertNoLeak(room, ctx, 'GUESS_JUDGE')
      }
    })
  }

  it('바보 모드: 라이어와 시민의 화면 정보 구조가 같다', () => {
    const { room, ctx, host } = setup(4)
    updateSettings(room, host, { mode: 'fool' }, ctx)
    startGame(room, host, ctx)
    const round = room.round!
    const citizen = round.participants.find((id) => id !== round.liarId)!
    const strip = (v: RoomView) => shape({ ...v, me: null, can: null })
    expect(strip(viewFor(room, round.liarId, ctx))).toEqual(strip(viewFor(room, citizen, ctx)))
  })
})

describe('무작위 진행 (퍼즈)', () => {
  it('무작위 행동 300라운드 동안 예외 없이 규칙을 지킨다', () => {
    const rng = seededRng(42)
    const r = (n: number) => Math.floor(rng() * n)
    const { room, ctx, ids, host } = setup(6, 7)
    let rounds = 0
    const actors = () => [...room.players.keys()]
    for (let step = 0; step < 60_000 && rounds < 300; step++) {
      const all = actors()
      if (all.length < 3) {
        for (let i = 0; i < 3; i++) addPlayer(room, `N${step}_${i}`, ctx)
        continue
      }
      const a = all[r(all.length)]!
      const b = all[r(all.length)]!
      const round = room.round
      switch (r(14)) {
        case 0:
          if (startGame(room, room.hostId, ctx).ok) rounds++
          break
        case 1:
          confirmRole(room, a, ctx)
          break
        case 2:
          if (round) submitHint(room, a, `설명${step}`, round.turnIndex, ctx)
          break
        case 3:
          setReady(room, a, true, ctx)
          break
        case 4:
          castVote(room, a, b, round?.vote?.round ?? 1, ctx)
          break
        case 5:
          submitGuess(room, a, ['짜장', '짬뽕', '사과', ''][r(4)]!, ctx)
          break
        case 6:
          judgeDecision(room, a, rng() < 0.5, ctx)
          break
        case 7:
          setConnected(room, a, rng() < 0.6, ctx)
          break
        case 8:
          if (rng() < 0.05) removePlayer(room, a, 'leave', ctx)
          break
        case 9:
          ctx.now += r(30_000)
          tick(room, ctx)
          break
        case 10:
          skipPhase(room, room.hostId, ctx)
          break
        case 11:
          updateSettings(room, room.hostId, { mode: rng() < 0.5 ? 'liar' : 'fool', judgeMode: (['auto', 'host', 'vote'] as const)[r(3)] }, ctx)
          break
        case 12:
          sendChat(room, a, '채팅', ctx)
          break
        case 13:
          if (room.phase === 'RESULT' && rng() < 0.3) backToLobby(room, room.hostId, ctx)
          break
      }

      // 불변 조건
      expect(room.players.has(room.hostId) || room.players.size === 0).toBe(true)
      if (room.round) {
        expect(room.round.participants).toContain(room.round.liarId)
        if (room.phase === 'RESULT') expect(room.round.reason).not.toBeNull()
        if (room.phase !== 'RESULT' && room.phase !== 'LOBBY') {
          for (const id of room.players.keys()) {
            expect(JSON.stringify(viewFor(room, id, ctx))).not.toContain('"liarId"')
          }
        }
      }
      if (room.phaseEndsAt !== null) expect(room.phase).not.toBe('LOBBY')
      room.effects = []
    }
    expect(rounds).toBeGreaterThan(50)
    expect(ids).toBeDefined()
    expect(host).toBeDefined()
  })
})
