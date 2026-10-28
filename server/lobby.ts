/**
 * 방 목록(레지스트리). 방 만들기·찾기·삭제, 비밀번호 확인, 로비에 보여 줄 요약, 오래된 방 정리를 맡는다.
 * 방 안의 게임 진행은 game.ts가 담당한다.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { LIMITS } from '../shared/constants.ts'
import type { CreateRoomPayload, LobbyRoomSummary } from '../shared/protocol.ts'
import { createRoom, isRoundActive } from './game.ts'
import type { GameContext, Player, Result, Room } from './game.ts'
import { cleanText } from './words/load.ts'

/** 헷갈리는 글자(I, O, 0, 1)를 뺀 방 코드 문자 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 4

/** 접속자가 없는 방을 지우기까지 */
export const EMPTY_ROOM_TTL = 15 * 60_000
/** 방의 최대 수명 */
export const ROOM_MAX_AGE = 24 * 60 * 60_000

export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : ''
}

function hashPassword(password: string, salt = randomBytes(8).toString('hex')): string {
  return `${salt}:${createHash('sha256').update(`${salt}:${password}`).digest('hex')}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt] = stored.split(':')
  const a = Buffer.from(hashPassword(password, salt))
  const b = Buffer.from(stored)
  return a.length === b.length && timingSafeEqual(a, b)
}

export class Lobby {
  readonly rooms = new Map<string, Room>()
  private readonly maxRooms: number

  constructor(options: { maxRooms: number }) {
    this.maxRooms = options.maxRooms
  }

  create(input: CreateRoomPayload, ctx: GameContext): Result<{ room: Room; player: Player }> {
    if (typeof input !== 'object' || input === null) return { ok: false, error: 'INVALID' }
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'TOO_MANY_ROOMS' }

    const name = typeof input.roomName === 'string' ? cleanText(input.roomName) : ''
    const nameLength = [...name].length
    if (nameLength < LIMITS.roomName.min || nameLength > LIMITS.roomName.max) return { ok: false, error: 'INVALID' }

    const maxPlayers = input.maxPlayers
    if (
      typeof maxPlayers !== 'number' ||
      !Number.isInteger(maxPlayers) ||
      maxPlayers < LIMITS.maxPlayers.min ||
      maxPlayers > LIMITS.maxPlayers.max
    ) {
      return { ok: false, error: 'INVALID' }
    }

    let passwordHash: string | null = null
    if (input.password !== undefined && input.password !== '') {
      if (typeof input.password !== 'string' || input.password.length > LIMITS.password.max) {
        return { ok: false, error: 'INVALID' }
      }
      passwordHash = hashPassword(input.password)
    }

    const result = createRoom(
      {
        code: this.newCode(ctx),
        name,
        isPrivate: input.isPrivate === true,
        passwordHash,
        maxPlayers,
        hostName: input.playerName,
      },
      ctx,
    )
    if (result.ok) this.rooms.set(result.room.code, result.room)
    return result
  }

  private newCode(ctx: GameContext): string {
    for (;;) {
      let code = ''
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(ctx.rng() * CODE_ALPHABET.length)]
      if (!this.rooms.has(code)) return code
    }
  }

  get(code: unknown): Room | undefined {
    return this.rooms.get(normalizeCode(code))
  }

  delete(code: string): void {
    this.rooms.delete(code)
  }

  checkPassword(room: Room, password: unknown): boolean {
    if (room.passwordHash === null) return true
    return typeof password === 'string' && verifyPassword(password, room.passwordHash)
  }

  summary(room: Room): LobbyRoomSummary {
    return {
      code: room.code,
      name: room.name,
      hostName: room.players.get(room.hostId)?.name ?? '',
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      playing: isRoundActive(room),
      mode: room.settings.mode,
      hasPassword: room.passwordHash !== null,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt,
    }
  }

  /** 로비 목록: 공개 방만, 대기 중인 방 먼저, 최근에 만든 방 먼저 */
  publicSummaries(): LobbyRoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate && r.players.size > 0)
      .map((r) => this.summary(r))
      .sort((a, b) => Number(a.playing) - Number(b.playing) || b.createdAt - a.createdAt)
  }

  /** 지워야 할 방의 코드 (빈 방, 오래 아무도 접속하지 않은 방, 너무 오래된 방) */
  expired(now: number): string[] {
    const out: string[] = []
    for (const room of this.rooms.values()) {
      const players = [...room.players.values()]
      if (players.length === 0) {
        out.push(room.code)
        continue
      }
      if (now - room.createdAt >= ROOM_MAX_AGE) {
        out.push(room.code)
        continue
      }
      if (players.every((p) => !p.connected)) {
        const lastSeen = Math.max(...players.map((p) => p.disconnectedAt ?? now))
        if (now - lastSeen >= EMPTY_ROOM_TTL) out.push(room.code)
      }
    }
    return out
  }
}
