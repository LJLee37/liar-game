<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { LobbyRoomSummary } from '../../../shared/protocol.ts'
import ChatBox from '../components/room/ChatBox.vue'
import GuessPanel from '../components/room/GuessPanel.vue'
import HintBoard from '../components/room/HintBoard.vue'
import JoinDialog from '../components/lobby/JoinDialog.vue'
import JudgePanel from '../components/room/JudgePanel.vue'
import PhaseHeader from '../components/room/PhaseHeader.vue'
import PlayerList from '../components/room/PlayerList.vue'
import ResultPanel from '../components/room/ResultPanel.vue'
import RevealPanel from '../components/room/RevealPanel.vue'
import SecretCard from '../components/room/SecretCard.vue'
import SettingsPanel from '../components/room/SettingsPanel.vue'
import VotePanel from '../components/room/VotePanel.vue'
import DiscussPanel from '../components/room/DiscussPanel.vue'
import { useLobbyStore } from '../stores/lobby.ts'
import { useRoomStore } from '../stores/room.ts'
import { useSessionStore } from '../stores/session.ts'

const props = defineProps<{ code: string }>()

const $q = useQuasar()
const router = useRouter()
const room = useRoomStore()
const lobby = useLobbyStore()
const session = useSessionStore()
const { view, takenOver, connected } = storeToRefs(room)

/** loading: 확인 중 / join: 입장 정보 입력 / missing: 방 없음 / in: 입장 완료 */
const status = ref<'loading' | 'join' | 'missing' | 'in'>('loading')
const summary = ref<LobbyRoomSummary | null>(null)

const code = computed(() => props.code.toUpperCase())
const phase = computed(() => view.value?.room.phase)
const inRound = computed(() => !!phase.value && phase.value !== 'LOBBY' && phase.value !== 'RESULT')

async function init() {
  status.value = 'loading'
  // 이미 이 방에 연결되어 있으면 그대로
  if (room.identity?.code === code.value && view.value?.room.code === code.value) {
    status.value = 'in'
    return
  }
  const saved = session.identityFor(code.value)
  if (saved) {
    const res = await room.resume(saved)
    if (res.ok) {
      status.value = 'in'
      return
    }
    if (res.error === 'TIMEOUT') {
      $q.notify({ type: 'negative', message: res.message })
    }
  }
  const peek = await lobby.peek(code.value)
  if (!peek.ok) {
    if (peek.error === 'NOT_FOUND') {
      status.value = 'missing'
    } else {
      // 서버에 연결하지 못함 → 연결되면 다시 시도 (watch(connected))
      $q.notify({ type: 'negative', message: peek.message })
      status.value = 'loading'
    }
    return
  }
  summary.value = peek.room
  status.value = 'join'
}

onMounted(init)
watch(code, init)
// 소켓이 다시 연결되었는데 아직 확인 중이면 재시도
watch(connected, (v) => {
  if (v && status.value === 'loading') void init()
})
// 강퇴·방 삭제 등으로 방 정보가 사라지면 로비로
watch(
  () => room.identity,
  (id) => {
    if (status.value === 'in' && !id) void router.push('/')
  },
)

function onJoined() {
  status.value = 'in'
}

function leave() {
  const message = inRound.value ? '게임 중에 나가면 다시 들어와도 이번 라운드에는 참가할 수 없어요. 나갈까요?' : '방에서 나갈까요?'
  $q.dialog({ title: '방 나가기', message, cancel: { flat: true, label: '취소' }, ok: { color: 'negative', label: '나가기', unelevated: true } }).onOk(
    async () => {
      await room.leave()
      void router.push('/')
    },
  )
}
</script>

<template>
  <q-page padding class="max-width">
    <div v-if="status === 'loading'" class="flex flex-center q-pa-xl">
      <q-spinner size="lg" color="primary" />
    </div>

    <div v-else-if="status === 'missing'" class="text-center q-pa-xl">
      <div class="text-h6 q-mb-md">방({{ code }})을 찾을 수 없어요.</div>
      <div class="text-body2 text-grey q-mb-lg">방이 닫혔거나 서버가 다시 시작되었을 수 있어요.</div>
      <q-btn color="primary" unelevated label="로비로" to="/" />
    </div>

    <JoinDialog v-else-if="status === 'join' && summary" :room="summary" @joined="onJoined" />

    <template v-else-if="status === 'in' && view">
      <q-banner v-if="takenOver" class="bg-warning text-black q-mb-md" rounded>
        다른 탭이나 기기에서 같은 플레이어로 접속 중이에요.
        <template #action>
          <q-btn flat label="이 탭에서 계속하기" @click="room.reclaim()" />
        </template>
      </q-banner>

      <PhaseHeader @leave="leave" />

      <div class="row q-col-gutter-md q-mt-xs">
        <div class="col-12 col-md-8 q-gutter-y-md">
          <template v-if="phase === 'LOBBY'">
            <SettingsPanel />
          </template>
          <template v-else-if="phase === 'ROLE_REVEAL'">
            <RevealPanel />
          </template>
          <template v-else-if="phase === 'RESULT'">
            <ResultPanel />
            <HintBoard />
          </template>
          <template v-else>
            <SecretCard compact />
            <VotePanel v-if="phase === 'VOTE'" />
            <GuessPanel v-if="phase === 'LIAR_GUESS'" />
            <JudgePanel v-if="phase === 'GUESS_JUDGE'" />
            <DiscussPanel v-if="phase === 'DISCUSS'" />
            <HintBoard />
          </template>
        </div>

        <div class="col-12 col-md-4 q-gutter-y-md">
          <PlayerList />
          <ChatBox />
        </div>
      </div>
    </template>
  </q-page>
</template>
