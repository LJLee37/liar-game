<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LIMITS } from '../../../../shared/constants.ts'
import { isSubmitEnter } from '../../labels.ts'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view, round } = storeToRefs(room)

const text = ref('')
const busy = ref(false)
const myTurn = computed(() => !!view.value?.can.hint)
const turn = computed(() => round.value?.turn ?? null)

/** 설명 순서대로 각 사람의 바퀴별 설명 */
const rows = computed(() => {
  const r = round.value
  if (!r) return []
  return r.order.map((id, index) => ({
    id,
    index,
    name: room.nameOf(id),
    left: r.left.includes(id),
    hints: r.hints.filter((h) => h.playerId === id),
    speaking: turn.value?.playerId === id,
  }))
})

async function submit() {
  const t = text.value.trim()
  if (!t || !turn.value || busy.value) return
  busy.value = true
  const ok = await room.submitHint(t, turn.value.index)
  busy.value = false
  if (ok) text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (isSubmitEnter(e)) {
    e.preventDefault()
    void submit()
  }
}

// 내 차례가 되면 탭 제목과 진동으로 알려 준다
const originalTitle = document.title
watch(myTurn, (v) => {
  document.title = v ? '🔔 내 차례! - 라이어 게임' : originalTitle
  if (v) navigator.vibrate?.(200)
})
onBeforeUnmount(() => {
  document.title = originalTitle
})
</script>

<template>
  <q-card v-if="round" flat bordered>
    <q-card-section class="row items-center">
      <div class="text-subtitle1 text-weight-bold">설명</div>
      <q-space />
      <div v-if="turn" class="text-caption">
        {{ turn.lap }} / {{ turn.laps }}바퀴 · {{ turn.index + 1 }} / {{ turn.total }}번째
      </div>
    </q-card-section>

    <q-card-section v-if="myTurn" class="q-pt-none">
      <q-input
        v-model="text"
        outlined
        autofocus
        color="primary"
        bg-color="yellow-1"
        label="내 차례예요! 제시어를 한 줄로 설명하세요"
        hint="제시어를 그대로 쓰면 안 돼요. Enter로 제출"
        :maxlength="LIMITS.hint.max"
        counter
        enterkeyhint="send"
        @keydown="onKeydown"
      >
        <template #append>
          <q-btn round dense flat icon="send" color="primary" :loading="busy" @click="submit" />
        </template>
      </q-input>
    </q-card-section>

    <q-list separator>
      <q-item v-for="row in rows" :key="row.id" :class="row.speaking ? 'bg-yellow-2 text-black' : ''">
        <q-item-section avatar>
          <q-avatar size="28px" :color="row.speaking ? 'primary' : 'grey-5'" text-color="white">
            {{ row.index + 1 }}
          </q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label :class="row.left ? 'text-strike text-grey' : 'text-weight-medium'">
            {{ row.name }}
            <span v-if="row.id === view!.me.id" class="text-caption">(나)</span>
          </q-item-label>
          <q-item-label v-for="h in row.hints" :key="h.lap" class="word-break">
            <span v-if="round.order.length > 0 && (turn?.laps ?? 1) > 1" class="text-caption text-grey">{{ h.lap }}바퀴: </span>
            <span v-if="h.status === 'ok'">“{{ h.text }}”</span>
            <span v-else-if="h.status === 'timeout'" class="text-grey">(시간 초과)</span>
            <span v-else class="text-grey">(건너뜀)</span>
          </q-item-label>
          <q-item-label v-if="row.speaking" caption>
            <q-spinner-dots size="1em" /> 설명 입력 중…
          </q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>
