<script setup lang="ts">
import { useQuasar } from 'quasar'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LIMITS } from '../../../../shared/constants.ts'
import { useRoomStore } from '../../stores/room.ts'
import { useSessionStore } from '../../stores/session.ts'

const open = defineModel<boolean>({ required: true })

const $q = useQuasar()
const router = useRouter()
const room = useRoomStore()
const session = useSessionStore()

const roomName = ref('')
const maxPlayers = ref(8)
const isPrivate = ref(false)
const password = ref('')
const busy = ref(false)

watch(open, (v) => {
  if (v && !roomName.value) roomName.value = `${session.nickname}의 방`.slice(0, LIMITS.roomName.max)
})

async function submit() {
  const name = roomName.value.trim()
  if (!name) {
    $q.notify({ type: 'warning', message: '방 이름을 입력해 주세요.' })
    return
  }
  busy.value = true
  const res = await room.create({
    roomName: name,
    maxPlayers: maxPlayers.value,
    isPrivate: isPrivate.value,
    password: password.value || undefined,
  })
  busy.value = false
  if (!res.ok) {
    $q.notify({ type: 'negative', message: res.message })
    return
  }
  open.value = false
  void router.push({ name: 'room', params: { code: res.code } })
}
</script>

<template>
  <q-dialog v-model="open">
    <q-card style="width: 420px; max-width: 92vw">
      <q-card-section class="text-h6">방 만들기</q-card-section>
      <q-card-section class="q-gutter-md">
        <q-input v-model="roomName" outlined label="방 이름" :maxlength="LIMITS.roomName.max" counter autofocus />
        <div>
          <div class="text-caption">최대 인원: {{ maxPlayers }}명</div>
          <q-slider
            v-model="maxPlayers"
            :min="LIMITS.maxPlayers.min"
            :max="LIMITS.maxPlayers.max"
            markers
            label
          />
        </div>
        <q-toggle v-model="isPrivate" label="비공개 방 (목록에 숨기고 코드·링크로만 입장)" />
        <q-input
          v-model="password"
          outlined
          dense
          type="password"
          label="비밀번호 (선택)"
          :maxlength="LIMITS.password.max"
          autocomplete="new-password"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="취소" v-close-popup />
        <q-btn color="primary" unelevated label="만들기" :loading="busy" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
