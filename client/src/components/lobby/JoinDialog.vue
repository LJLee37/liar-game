<script setup lang="ts">
import { useQuasar } from 'quasar'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LIMITS, MODE_LABELS } from '../../../../shared/constants.ts'
import type { LobbyRoomSummary } from '../../../../shared/protocol.ts'
import { useRoomStore } from '../../stores/room.ts'
import { useSessionStore } from '../../stores/session.ts'

const props = defineProps<{ room: LobbyRoomSummary }>()
const emit = defineEmits<{ joined: [] }>()

const $q = useQuasar()
const router = useRouter()
const roomStore = useRoomStore()
const session = useSessionStore()

const nickname = ref(session.nickname)
const password = ref('')
const busy = ref(false)

async function submit() {
  const name = nickname.value.trim()
  const len = [...name].length
  if (len < LIMITS.playerName.min || len > LIMITS.playerName.max) {
    $q.notify({ type: 'warning', message: `닉네임을 ${LIMITS.playerName.min}~${LIMITS.playerName.max}자로 입력해 주세요.` })
    return
  }
  session.setNickname(name)
  busy.value = true
  const res = await roomStore.join(props.room.code, password.value || undefined)
  busy.value = false
  if (!res.ok) {
    $q.notify({ type: 'negative', message: res.message })
    return
  }
  emit('joined')
}
</script>

<template>
  <div class="flex flex-center q-pa-md">
    <q-card flat bordered style="width: 420px; max-width: 100%">
      <q-card-section>
        <div class="text-h6 word-break">{{ room.name }}</div>
        <div class="text-caption text-grey">
          코드 {{ room.code }} · 방장 {{ room.hostName }} · {{ MODE_LABELS[room.mode] }} · {{ room.playerCount }}/{{ room.maxPlayers }}명
          <span v-if="room.playing"> · 게임 중 (다음 라운드부터 참가)</span>
        </div>
      </q-card-section>
      <q-card-section class="q-gutter-md">
        <q-input
          v-model="nickname"
          outlined
          label="닉네임"
          :maxlength="LIMITS.playerName.max"
          counter
          autofocus
          @keydown.enter="!room.hasPassword && submit()"
        />
        <q-input
          v-if="room.hasPassword"
          v-model="password"
          outlined
          type="password"
          label="비밀번호"
          autocomplete="off"
          @keydown.enter="submit"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="로비로" @click="router.push('/')" />
        <q-btn color="primary" unelevated label="입장" :loading="busy" @click="submit" />
      </q-card-actions>
    </q-card>
  </div>
</template>
