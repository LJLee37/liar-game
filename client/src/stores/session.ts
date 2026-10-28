/**
 * 브라우저에 저장하는 정보.
 * - 닉네임: localStorage (다음 방문 때도 기억)
 * - 방별 플레이어 신원(id·토큰): sessionStorage (탭마다 따로 → 한 브라우저에서 탭 여러 개로 테스트 가능)
 * - 마지막 참가 방: localStorage (탭을 닫았다가 돌아왔을 때 "이전 방으로 돌아가기" 버튼용)
 *
 * 저장소 접근은 사생활 보호 모드 등에서 실패할 수 있으므로 항상 try/catch로 감싼다.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JoinedRoom } from '../../../shared/protocol.ts'

const NICKNAME_KEY = 'liar:nickname'
const LAST_ROOM_KEY = 'liar:lastRoom'
const sessionKey = (code: string) => `liar:session:${code}`

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, value)
  } catch {
    // 저장 실패는 무시 (기능은 그대로 동작하고 재접속만 불편해짐)
  }
}

function parseIdentity(raw: string | null): JoinedRoom | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as JoinedRoom
    return typeof v.code === 'string' && typeof v.playerId === 'string' && typeof v.token === 'string' ? v : null
  } catch {
    return null
  }
}

export const useSessionStore = defineStore('session', () => {
  const nickname = ref(read(() => localStorage, NICKNAME_KEY) ?? '')

  function setNickname(name: string) {
    nickname.value = name
    write(() => localStorage, NICKNAME_KEY, name)
  }

  function identityFor(code: string): JoinedRoom | null {
    return parseIdentity(read(() => sessionStorage, sessionKey(code)))
  }

  function saveIdentity(identity: JoinedRoom) {
    const json = JSON.stringify(identity)
    write(() => sessionStorage, sessionKey(identity.code), json)
    write(() => localStorage, LAST_ROOM_KEY, json)
  }

  function clearIdentity(code: string) {
    write(() => sessionStorage, sessionKey(code), null)
    const last = lastRoom()
    if (last?.code === code) write(() => localStorage, LAST_ROOM_KEY, null)
  }

  function lastRoom(): JoinedRoom | null {
    return parseIdentity(read(() => localStorage, LAST_ROOM_KEY))
  }

  return { nickname, setNickname, identityFor, saveIdentity, clearIdentity, lastRoom }
})
