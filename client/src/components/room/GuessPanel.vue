<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { LIMITS } from '../../../../shared/constants.ts'
import { isSubmitEnter } from '../../labels.ts'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view, round } = storeToRefs(room)
const text = ref('')
const busy = ref(false)
const accused = computed(() => room.nameOf(round.value?.accusedId))

async function submit() {
  const t = text.value.trim()
  if (!t || busy.value) return
  busy.value = true
  await room.guess(t)
  busy.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (isSubmitEnter(e)) {
    e.preventDefault()
    void submit()
  }
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section v-if="view!.can.guess">
      <div class="text-h6 text-accent">들켰어요! 당신이 라이어였습니다.</div>
      <div class="text-body2 q-mb-md">
        <template v-if="round!.mode === 'fool' && round!.secret.kind === 'word'">
          내가 받은 “{{ round!.secret.word }}”는 라이어용 단어였어요.
        </template>
        시민들의 제시어를 맞히면 역전승! 띄어쓰기나 가벼운 오타는 괜찮아요.
      </div>
      <q-input
        v-model="text"
        outlined
        autofocus
        label="시민들의 제시어는?"
        :maxlength="LIMITS.guess.max"
        enterkeyhint="send"
        @keydown="onKeydown"
      >
        <template #append>
          <q-btn unelevated color="accent" label="제출" :loading="busy" @click="submit" />
        </template>
      </q-input>
    </q-card-section>
    <q-card-section v-else class="text-center q-py-lg">
      <div class="text-h6">라이어는 {{ accused }}님이었어요!</div>
      <div class="text-body2 q-mt-sm"><q-spinner-dots /> {{ accused }}님이 제시어를 맞히는 중…</div>
    </q-card-section>
  </q-card>
</template>
