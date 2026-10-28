/**
 * 서버와 클라이언트가 함께 쓰는 Socket.IO 이벤트·데이터 타입.
 *
 * 이벤트 이름과 페이로드를 여기 한 곳에서 정의하면, 서버(`server/socket.ts`)와
 * 클라이언트(`client/src/socket.ts`)가 서로 다른 모양의 데이터를 주고받는 실수를
 * TypeScript가 컴파일 단계에서 잡아 준다.
 * 참고: https://socket.io/docs/v4/typescript/
 */

// ── 기본 열거형 ────────────────────────────────────────────────

/** 게임 진행 단계 */
export type Phase =
  | 'LOBBY' // 방 대기실
  | 'ROLE_REVEAL' // 제시어 확인
  | 'DESCRIBE' // 순서대로 한 줄 설명
  | 'DISCUSS' // 자유 토론(채팅)
  | 'VOTE' // 라이어 지목 투표
  | 'LIAR_GUESS' // 지목된 라이어가 제시어 맞히기
  | 'GUESS_JUDGE' // 애매한 정답을 방장/플레이어가 판정
  | 'RESULT' // 결과 공개

/** liar = 라이어 모드(라이어에게 "라이어"라고 알려 줌), fool = 바보 모드(라이어가 다른 제시어를 받음) */
export type GameMode = 'liar' | 'fool'

/** 애매한 추측의 판정 방식 */
export type JudgeMode = 'auto' | 'host' | 'vote'

export type ErrorCode =
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'NAME_TAKEN'
  | 'NAME_INVALID'
  | 'WRONG_PASSWORD'
  | 'AUTH_FAILED'
  | 'NOT_IN_ROOM'
  | 'ALREADY_IN_ROOM'
  | 'NOT_HOST'
  | 'WRONG_PHASE'
  | 'NOT_ALLOWED'
  | 'NOT_YOUR_TURN'
  | 'STALE'
  | 'INVALID'
  | 'NOT_ENOUGH_PLAYERS'
  | 'CONTAINS_WORD'
  | 'RATE_LIMITED'
  | 'TOO_MANY_ROOMS'
  | 'NO_CATEGORIES'
  | 'TIMEOUT'
  | 'INTERNAL'

// ── 설정 ──────────────────────────────────────────────────────

export interface RoomSettings {
  mode: GameMode
  /** 출제할 카테고리 id 목록. 비어 있으면 전체 카테고리에서 무작위 */
  categoryIds: string[]
  /** 설명 바퀴 수 (1~3) */
  laps: number
  /** 한 사람당 설명 제한 시간(초) */
  hintSeconds: number
  /** 자유 토론 시간(초) */
  discussSeconds: number
  judgeMode: JudgeMode
}

export interface RoomSettingsUpdate extends Partial<RoomSettings> {
  maxPlayers?: number
}

// ── 로비 ──────────────────────────────────────────────────────

export interface LobbyRoomSummary {
  code: string
  name: string
  hostName: string
  playerCount: number
  maxPlayers: number
  playing: boolean
  mode: GameMode
  hasPassword: boolean
  isPrivate: boolean
  createdAt: number
}

export interface CreateRoomPayload {
  roomName: string
  playerName: string
  maxPlayers: number
  isPrivate: boolean
  password?: string
}

export interface JoinRoomPayload {
  code: string
  playerName: string
  password?: string
}

export interface ResumePayload {
  code: string
  playerId: string
  token: string
}

export interface JoinedRoom {
  code: string
  playerId: string
  token: string
}

// ── 방 화면(View) ──────────────────────────────────────────────

export interface CategoryInfo {
  id: string
  name: string
  icon: string | null
  wordCount: number
}

export interface PlayerView {
  id: string
  name: string
  connected: boolean
  score: number
  isHost: boolean
  /** 진행 중인 라운드의 참가자인지 (false면 관전 중) */
  isParticipant: boolean
}

export interface ChatMessage {
  id: number
  /** null이면 시스템 메시지 */
  playerId: string | null
  name: string
  text: string
  at: number
}

/** 내 카드: 제시어 / 라이어 / 정보 없음(관전자) */
export type Secret = { kind: 'word'; word: string } | { kind: 'liar' } | { kind: 'none' }

export interface HintView {
  playerId: string
  lap: number
  text: string
  status: 'ok' | 'timeout' | 'skipped'
}

export interface VoteView {
  round: 1 | 2
  candidates: string[]
  /** 이미 투표한 사람 (누구에게 투표했는지는 결과 화면에서 공개) */
  voted: string[]
  myVote: string | null
  /** 재투표일 때 1차 투표 득표 수 */
  prevTally: Record<string, number> | null
}

export interface JudgeView {
  method: 'host' | 'vote'
  judgeIds: string[]
  voted: string[]
  myVote: boolean | null
  /** 정답(시민 제시어). 라이어·관전자에게는 null */
  answer: string | null
  /** 0~1, 자모 단위 유사도 */
  similarity: number
  /** 자동 판정이 제안하는 결과 */
  suggestion: 'accept' | 'reject'
}

export type ResultReason =
  | 'wrong_accusation' // 시민을 라이어로 지목
  | 'tie' // 재투표도 동률
  | 'no_votes' // 아무도 투표하지 않음
  | 'guessed' // 라이어가 검거됐지만 제시어를 맞힘
  | 'guess_failed' // 라이어가 검거되고 제시어도 못 맞힘
  | 'liar_left' // 검거된 라이어가 나감
  | 'aborted' // 라운드 중단

export type JudgeReason = 'exact' | 'alias' | 'other-word' | 'empty' | 'similar' | 'different'

export interface JudgementView {
  guess: string
  accepted: boolean
  /** rule: 규칙으로 즉시 판정, auto: 유사도 자동 판정, host/vote: 사람 판정 */
  method: 'rule' | 'auto' | 'host' | 'vote'
  reason: JudgeReason
  similarity: number
  /** 사람이 시간 안에 판정하지 않아 자동 제안으로 결정됐는지 */
  timedOut: boolean
}

export interface ResultView {
  winner: 'liar' | 'citizens' | null
  reason: ResultReason
  liarId: string
  citizenWord: string
  /** 바보 모드에서 라이어가 받은 단어 */
  liarWord: string | null
  accusedId: string | null
  votes: { voterId: string; targetId: string; round: 1 | 2 }[]
  judgement: JudgementView | null
  judgeVotes: { judgeId: string; accept: boolean }[]
  scoreDelta: Record<string, number>
}

export interface RoundView {
  no: number
  mode: GameMode
  categoryName: string
  categoryIcon: string | null
  /** 설명 순서 (플레이어 id) */
  order: string[]
  /** 라운드 시작 시점의 이름 (나간 사람도 표시하기 위함) */
  names: Record<string, string>
  left: string[]
  secret: Secret
  confirmed: string[]
  turn: { index: number; total: number; lap: number; laps: number; playerId: string | null } | null
  hints: HintView[]
  ready: string[]
  vote: VoteView | null
  accusedId: string | null
  guess: string | null
  judge: JudgeView | null
  result: ResultView | null
}

export interface Capabilities {
  start: boolean
  settings: boolean
  confirm: boolean
  hint: boolean
  ready: boolean
  vote: boolean
  guess: boolean
  judge: boolean
  skip: boolean
  abort: boolean
  toLobby: boolean
  chat: boolean
  kick: boolean
}

export interface RoomView {
  /** 서버 시각(ms). 클라이언트 시계 오차 보정용 */
  now: number
  me: { id: string; name: string; isHost: boolean; isParticipant: boolean }
  room: {
    code: string
    name: string
    isPrivate: boolean
    hasPassword: boolean
    maxPlayers: number
    hostId: string
    phase: Phase
    phaseEndsAt: number | null
    settings: RoomSettings
    players: PlayerView[]
    categories: CategoryInfo[]
  }
  chat: ChatMessage[]
  round: RoundView | null
  can: Capabilities
}

export interface Notice {
  code: string
  level: 'info' | 'warning' | 'error'
  message: string
}

// ── 이벤트 ────────────────────────────────────────────────────

export type AckResponse<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode; message: string }
export type Ack<T = object> = (res: AckResponse<T>) => void

export interface ClientToServerEvents {
  'lobby:subscribe': (ack: Ack<{ rooms: LobbyRoomSummary[] }>) => void
  'lobby:unsubscribe': () => void
  'room:create': (payload: CreateRoomPayload, ack: Ack<JoinedRoom>) => void
  'room:peek': (payload: { code: string }, ack: Ack<{ room: LobbyRoomSummary }>) => void
  'room:join': (payload: JoinRoomPayload, ack: Ack<JoinedRoom>) => void
  'room:resume': (payload: ResumePayload, ack: Ack<JoinedRoom>) => void
  'room:leave': (ack: Ack) => void
  'room:kick': (payload: { playerId: string }, ack: Ack) => void
  'room:transferHost': (payload: { playerId: string }, ack: Ack) => void
  'room:updateSettings': (payload: RoomSettingsUpdate, ack: Ack) => void
  'room:resetScores': (ack: Ack) => void
  'chat:send': (payload: { text: string }, ack: Ack) => void
  'game:start': (ack: Ack) => void
  'game:confirmRole': (ack: Ack) => void
  'game:submitHint': (payload: { text: string; turnIndex: number }, ack: Ack) => void
  'game:ready': (payload: { ready: boolean }, ack: Ack) => void
  'game:skipPhase': (ack: Ack) => void
  'game:vote': (payload: { targetId: string; voteRound: 1 | 2 }, ack: Ack) => void
  'game:submitGuess': (payload: { text: string }, ack: Ack) => void
  'game:judge': (payload: { accept: boolean }, ack: Ack) => void
  'game:abort': (ack: Ack) => void
  'game:toLobby': (ack: Ack) => void
}

export interface ServerToClientEvents {
  'lobby:rooms': (rooms: LobbyRoomSummary[]) => void
  state: (view: RoomView) => void
  notice: (notice: Notice) => void
}
