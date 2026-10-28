/** 로비의 방 목록 (서버가 바뀔 때마다 보내 준다) */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LobbyRoomSummary } from '../../../shared/protocol.ts'
import { request, socket } from '../socket.ts'

export const useLobbyStore = defineStore('lobby', () => {
  const rooms = ref<LobbyRoomSummary[]>([])
  const loaded = ref(false)
  let subscribed = false

  socket.on('lobby:rooms', (list) => {
    rooms.value = list
  })
  // 재연결되면 목록 구독을 다시 요청 (서버는 연결마다 구독을 따로 관리)
  socket.on('connect', () => {
    if (subscribed) void fetchAndSubscribe()
  })

  async function fetchAndSubscribe() {
    const res = await request<{ rooms: LobbyRoomSummary[] }>((s) => s.emitWithAck('lobby:subscribe'))
    if (res.ok) {
      rooms.value = res.rooms
      loaded.value = true
    }
  }

  function subscribe() {
    subscribed = true
    void fetchAndSubscribe()
  }

  function unsubscribe() {
    subscribed = false
    socket.emit('lobby:unsubscribe')
  }

  async function peek(code: string) {
    return request<{ room: LobbyRoomSummary }>((s) => s.emitWithAck('room:peek', { code }))
  }

  return { rooms, loaded, subscribe, unsubscribe, peek }
})
