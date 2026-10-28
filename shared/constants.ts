/**
 * 게임 규칙 상수. 서버와 클라이언트가 함께 사용한다.
 * 시간 값은 모두 밀리초(ms)이며, 설정 화면에서 바꾸는 값만 초 단위다.
 */
import type { ErrorCode, GameMode, JudgeMode, Phase, RoomSettings } from './protocol.ts'

/** 글자 수 제한 (정규화 후 기준) */
export const LIMITS = {
  playerName: { min: 1, max: 10 },
  roomName: { min: 1, max: 20 },
  password: { max: 20 },
  hint: { min: 1, max: 40 },
  chat: { min: 1, max: 200 },
  guess: { min: 1, max: 30 },
  /** 게임 시작에 필요한 최소 인원 */
  minPlayers: 3,
  /** 방 최대 인원 설정 범위 */
  maxPlayers: { min: 3, max: 12 },
  /** 방에 보관하는 채팅 수 */
  chatHistory: 100,
} as const

/** 설정 화면에서 고를 수 있는 범위 */
export const SETTING_RANGES = {
  laps: { min: 1, max: 3 },
  hintSeconds: { min: 15, max: 120 },
  discussSeconds: { min: 30, max: 600 },
} as const

export const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'liar',
  categoryIds: [],
  laps: 1,
  hintSeconds: 40,
  discussSeconds: 120,
  judgeMode: 'host',
}

/** 단계별 제한 시간 등 (ms) */
export const TIMINGS = {
  roleReveal: 20_000,
  voteFirst: 60_000,
  voteSecond: 45_000,
  liarGuess: 45_000,
  /** 라이어가 접속이 끊긴 상태일 때 정답 입력 시간 */
  liarGuessDisconnected: 20_000,
  guessJudge: 30_000,
  /** 접속이 끊긴 사람의 설명 차례 */
  describeDisconnected: 10_000,
  /** 설명 도중 접속이 끊겼을 때 남은 시간 상한 */
  describeDisconnectGrace: 15_000,
  /** 방장이 끊긴 뒤 방장을 넘기기까지 */
  hostTransferDelay: 20_000,
  /** 대기실/결과 화면에서 끊긴 사람을 방에서 내보내기까지 */
  idleRemoveDelay: 90_000,
} as const

/** 점수 */
export const SCORE = {
  /** 라이어가 살아남음 (오지목·동률·무투표) */
  liarEscaped: 2,
  /** 라이어가 검거됐지만 제시어를 맞힘 */
  liarGuessed: 1,
  /** 라이어 검거 + 오답 → 시민 각자 */
  citizenWin: 1,
} as const

export const MODE_LABELS: Record<GameMode, string> = {
  liar: '라이어 모드',
  fool: '바보 모드',
}

export const MODE_DESCRIPTIONS: Record<GameMode, string> = {
  liar: '라이어는 자신이 라이어라는 것과 카테고리만 압니다.',
  fool: '라이어도 같은 카테고리의 다른 제시어를 받으며, 자신이 라이어인지 모릅니다.',
}

export const JUDGE_MODE_LABELS: Record<JudgeMode, string> = {
  auto: '자동 판정',
  host: '방장 판정',
  vote: '플레이어 투표',
}

export const JUDGE_MODE_DESCRIPTIONS: Record<JudgeMode, string> = {
  auto: '애매한 답도 유사도로 자동 판정합니다.',
  host: '애매한 답은 방장이 인정 여부를 정합니다.',
  vote: '애매한 답은 시민들이 투표로 정합니다.',
}

export const PHASE_LABELS: Record<Phase, string> = {
  LOBBY: '대기 중',
  ROLE_REVEAL: '제시어 확인',
  DESCRIBE: '설명',
  DISCUSS: '토론',
  VOTE: '투표',
  LIAR_GUESS: '라이어의 정답 도전',
  GUESS_JUDGE: '정답 판정',
  RESULT: '결과',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: '방을 찾을 수 없어요.',
  ROOM_FULL: '방이 가득 찼어요.',
  NAME_TAKEN: '이미 같은 닉네임이 방에 있어요.',
  NAME_INVALID: `닉네임은 ${LIMITS.playerName.min}~${LIMITS.playerName.max}자로 입력해 주세요.`,
  WRONG_PASSWORD: '비밀번호가 맞지 않아요.',
  AUTH_FAILED: '재접속 정보가 맞지 않아요.',
  NOT_IN_ROOM: '방에 들어가 있지 않아요.',
  ALREADY_IN_ROOM: '이미 다른 방에 들어가 있어요.',
  NOT_HOST: '방장만 할 수 있어요.',
  WRONG_PHASE: '지금은 할 수 없어요.',
  NOT_ALLOWED: '권한이 없어요.',
  NOT_YOUR_TURN: '내 차례가 아니에요.',
  STALE: '화면 정보가 오래됐어요. 다시 시도해 주세요.',
  INVALID: '입력값이 올바르지 않아요.',
  NOT_ENOUGH_PLAYERS: `접속 중인 플레이어가 ${LIMITS.minPlayers}명 이상이어야 해요.`,
  CONTAINS_WORD: '설명에 제시어를 그대로 쓸 수 없어요.',
  RATE_LIMITED: '너무 빨라요. 잠시 후 다시 시도해 주세요.',
  TOO_MANY_ROOMS: '방이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  NO_CATEGORIES: '출제할 수 있는 카테고리가 없어요.',
  TIMEOUT: '서버 응답이 없어요.',
  INTERNAL: '서버 오류가 발생했어요.',
}
