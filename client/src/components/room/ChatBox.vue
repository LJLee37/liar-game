<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { LIMITS } from '../../../../shared/constants.ts'
import { isSubmitEnter } from '../../labels.ts'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view } = storeToRefs(room)

const text = ref('')
const listEl = ref<HTMLElement | null>(null)
const messages = computed(() => view.value?.chat ?? [])
const canChat = computed(() => !!view.value?.can.chat)

const disabledReason = computed(() => {
  const phase = view.value?.room.phase
  if (phase === 'ROLE_REVEAL' || phase === 'DESCRIBE') return '설명 단계에서는 채팅을 할 수 없어요'
  return '관전 중에는 채팅을 할 수 없어요'
})

// 새 메시지가 오면, 이미 맨 아래를 보고 있을 때만 자동으로 내려간다
watch(
  () => messages.value.at(-1)?.id,
  async () => {
    const el = listEl.value
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
    await nextTick()
    if (nearBottom && listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  },
  { immediate: true },
)

async function send() {
  const t = text.value.trim()
  if (!t) return
  if (await room.chat(t)) text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (isSubmitEnter(e)) {
    e.preventDefault()
    void send()
  }
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="q-pb-sm text-subtitle1 text-weight-bold">채팅</q-card-section>
    <div ref="listEl" class="q-px-md" style="height: 280px; overflow-y: auto">
      <div v-for="m in messages" :key="m.id" class="q-mb-xs word-break">
        <div v-if="m.playerId === null" class="text-caption text-grey text-center">{{ m.text }}</div>
        <div v-else>
          <span class="text-weight-bold" :class="m.playerId === view!.me.id ? 'text-primary' : ''">{{ m.name }}</span>
          <span class="text-caption text-grey q-ml-xs">{{ time(m.at) }}</span>
          <div class="text-body2">{{ m.text }}</div>
        </div>
      </div>
    </div>
    <q-card-section class="q-pt-sm">
      <q-input
        v-model="text"
        dense
        outlined
        :disable="!canChat"
        :placeholder="canChat ? '메시지 입력 (Enter)' : disabledReason"
        :maxlength="LIMITS.chat.max"
        enterkeyhint="send"
        @keydown="onKeydown"
      >
        <template #append>
          <q-btn flat round dense icon="send" :disable="!canChat" @click="send" />
        </template>
      </q-input>
    </q-card-section>
  </q-card>
</template>
