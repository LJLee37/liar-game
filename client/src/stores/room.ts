/**
 * 현재 들어가 있는 방의 상태.
 * 서버가 보내 주는 RoomView를 그대로 보관한다 (게임 규칙 판단은 모두 서버가 하고, 화면은 보여 주기만 한다).
 */
import { defineStore } from 'pinia'
import { Notify } from 'quasar'
import { computed, ref } from 'vue'
import type { AckResponse, JoinedRoom, Notice, RoomSettingsUpdate, RoomView } from '../../../shared/protocol.ts'
import { router } from '../router.ts'
import { request, socket } from '../socket.ts'
import { useSessionStore } from './session.ts'

/** 서버에서 방을 잃었을 때(방 삭제·강퇴 등) 받는 알림 코드 */
const LOST_ROOM_NOTICES = new Set(['KICKED', 'REMOVED', 'ROOM_CLOSED'])

export const useRoomStore = defineStore('room', () => {
  const session = useSessionStore()

  const view = ref<RoomView | null>(null)
  /** 서버 시계 - 내 시계 (ms) */
  const clockOffset = ref(0)
  const connected = ref(socket.connected)
  /** 다른 탭에서 같은 플레이어로 접속해 이 탭의 연결이 넘어간 상태 */
  const takenOver = ref(false)
  /** 현재 참가 중인 방 신원 */
  const identity = ref<JoinedRoom | null>(null)

  const me = computed(() => view.value?.me ?? null)
  const round = computed(() => view.value?.round ?? null)

  function nameOf(id: string | null | undefined): string {
    if (!id) return ''
    return (
      view.value?.round?.names[id] ?? view.value?.room.players.find((p) => p.id === id)?.name ?? '(나간 사람)'
    )
  }

  // ── 서버 이벤트 ───────────────────────────────────────────

  socket.on('connect', () => {
    connected.value = true
    // 끊겼다가 다시 연결되면 자동으로 같은 플레이어로 복귀
    if (identity.value && !takenOver.value) {
      void resume(identity.value).then((res) => {
        if (!res.ok && (res.error === 'NOT_FOUND' || res.error === 'AUTH_FAILED')) {
          Notify.create({ type: 'warning', message: '방이 사라졌어요. (서버가 다시 시작되었을 수 있어요)' })
        }
      })
    }
  })
  socket.on('disconnect', () => {
    connected.value = false
  })
  socket.on('state', (v) => {
    if (!identity.value || v.room.code !== identity.value.code) return
    clockOffset.value = v.now - Date.now()
    view.value = v
  })
  socket.on('notice', (n: Notice) => {
    Notify.create({ type: n.level === 'error' ? 'negative' : n.level === 'warning' ? 'warning' : 'info', message: n.message })
    if (n.code === 'TAKEN_OVER') {
      takenOver.value = true
      return
    }
    if (LOST_ROOM_NOTICES.has(n.code) && identity.value) {
      session.clearIdentity(identity.value.code)
      reset()
      void router.push('/')
    }
  })

  // 모바일 브라우저는 백그라운드에서 연결을 끊는 경우가 많다 → 화면으로 돌아오면 바로 재연결
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !socket.connected) socket.connect()
    })
  }

  function reset() {
    view.value = null
    identity.value = null
    takenOver.value = false
  }

  function enter(joined: JoinedRoom) {
    // 다른 방으로 옮기면 서버가 이전 방에서 내보내므로 이전 방 신원도 지운다
    const previous = identity.value
    if (previous && previous.code !== joined.code) session.clearIdentity(previous.code)
    identity.value = joined
    takenOver.value = false
    session.saveIdentity(joined)
  }

  // ── 입장·퇴장 ──────────────────────────────────────────────

  async function resume(saved: JoinedRoom): Promise<AckResponse<JoinedRoom>> {
    identity.value = saved
    const res = await request<JoinedRoom>((s) => s.emitWithAck('room:resume', saved))
    if (res.ok) {
      enter(res)
    } else if (res.error === 'NOT_FOUND' || res.error === 'AUTH_FAILED') {
      session.clearIdentity(saved.code)
      if (identity.value?.code === saved.code) reset()
    }
    return res
  }

  /** 다른 탭에 넘어간 연결을 이 탭으로 다시 가져오기 */
  async function reclaim() {
    if (!identity.value) return
    takenOver.value = false
    await resume(identity.value)
  }

  async function create(payload: { roomName: string; maxPlayers: number; isPrivate: boolean; password?: string }) {
    const res = await request<JoinedRoom>((s) =>
      s.emitWithAck('room:create', { ...payload, playerName: session.nickname }),
    )
    if (res.ok) enter(res)
    return res
  }

  async function join(code: string, password?: string) {
    const res = await request<JoinedRoom>((s) =>
      s.emitWithAck('room:join', { code, playerName: session.nickname, password }),
    )
    if (res.ok) enter(res)
    return res
  }

  async function leave() {
    const code = identity.value?.code
    await request((s) => s.emitWithAck('room:leave'))
    if (code) session.clearIdentity(code)
    reset()
  }

  // ── 게임 행동: 실패하면 알림만 띄운다 ──────────────────────

  async function act(send: Parameters<typeof request>[0]): Promise<boolean> {
    const res = await request(send)
    if (!res.ok) Notify.create({ type: 'negative', message: res.message })
    return res.ok
  }

  const actions = {
    start: () => act((s) => s.emitWithAck('game:start')),
    confirmRole: () => act((s) => s.emitWithAck('game:confirmRole')),
    submitHint: (text: string, turnIndex: number) => act((s) => s.emitWithAck('game:submitHint', { text, turnIndex })),
    setReady: (ready: boolean) => act((s) => s.emitWithAck('game:ready', { ready })),
    skip: () => act((s) => s.emitWithAck('game:skipPhase')),
    vote: (targetId: string, voteRound: 1 | 2) => act((s) => s.emitWithAck('game:vote', { targetId, voteRound })),
    guess: (text: string) => act((s) => s.emitWithAck('game:submitGuess', { text })),
    judge: (accept: boolean) => act((s) => s.emitWithAck('game:judge', { accept })),
    abort: () => act((s) => s.emitWithAck('game:abort')),
    toLobby: () => act((s) => s.emitWithAck('game:toLobby')),
    chat: (text: string) => act((s) => s.emitWithAck('chat:send', { text })),
    updateSettings: (update: RoomSettingsUpdate) => act((s) => s.emitWithAck('room:updateSettings', update)),
    resetScores: () => act((s) => s.emitWithAck('room:resetScores')),
    kick: (playerId: string) => act((s) => s.emitWithAck('room:kick', { playerId })),
    transferHost: (playerId: string) => act((s) => s.emitWithAck('room:transferHost', { playerId })),
  }

  return {
    view,
    clockOffset,
    connected,
    takenOver,
    identity,
    me,
    round,
    nameOf,
    resume,
    reclaim,
    create,
    join,
    leave,
    ...actions,
  }
})
