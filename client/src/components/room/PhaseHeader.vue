<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { copyToClipboard, useQuasar } from 'quasar'
import { computed } from 'vue'
import { MODE_LABELS, PHASE_LABELS } from '../../../../shared/constants.ts'
import { useCountdown } from '../../composables/useCountdown.ts'
import { useRoomStore } from '../../stores/room.ts'

const emit = defineEmits<{ leave: [] }>()

const $q = useQuasar()
const room = useRoomStore()
const { view, clockOffset } = storeToRefs(room)

const r = computed(() => view.value!.room)
const round = computed(() => view.value!.round)
const can = computed(() => view.value!.can)
const { seconds } = useCountdown(
  computed(() => r.value.phaseEndsAt),
  clockOffset,
)

const skipLabel = computed(() => {
  switch (r.value.phase) {
    case 'ROLE_REVEAL':
      return '설명 시작'
    case 'DESCRIBE':
      return '이번 차례 건너뛰기'
    case 'DISCUSS':
      return '바로 투표'
    default:
      return ''
  }
})

function copyInvite() {
  const url = `${location.origin}/room/${r.value.code}`
  copyToClipboard(url)
    .then(() => $q.notify({ type: 'positive', message: '초대 링크를 복사했어요.' }))
    .catch(() => $q.notify({ type: 'info', message: url }))
}

function confirmAbort() {
  $q.dialog({
    title: '라운드 중단',
    message: '이번 라운드를 중단할까요? 점수는 바뀌지 않아요.',
    cancel: { flat: true, label: '취소' },
    ok: { color: 'negative', label: '중단', unelevated: true },
  }).onOk(() => void room.abort())
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-col-gutter-sm">
      <div class="col-12 col-sm">
        <div class="text-h6 word-break">
          {{ r.name }}
          <q-icon v-if="r.hasPassword" name="lock" size="xs" />
          <q-icon v-if="r.isPrivate" name="visibility_off" size="xs" class="q-ml-xs">
            <q-tooltip>비공개 방</q-tooltip>
          </q-icon>
        </div>
        <div class="row items-center q-gutter-xs text-caption">
          <q-chip dense clickable icon="link" :label="`코드 ${r.code}`" @click="copyInvite">
            <q-tooltip>초대 링크 복사</q-tooltip>
          </q-chip>
          <q-chip dense color="primary" text-color="white" :label="PHASE_LABELS[r.phase]" />
          <q-chip v-if="round" dense outline :label="`${round.no}라운드 · ${MODE_LABELS[round.mode]}`" />
          <q-chip v-if="round" dense outline>
            {{ round.categoryIcon ?? '' }} {{ round.categoryName }}
          </q-chip>
          <q-chip
            v-if="seconds !== null"
            dense
            icon="timer"
            :color="seconds <= 10 ? 'negative' : 'grey-3'"
            :text-color="seconds <= 10 ? 'white' : 'black'"
            :label="`${seconds}초`"
          />
        </div>
      </div>
      <div class="col-12 col-sm-auto row q-gutter-xs justify-end">
        <q-btn v-if="can.skip" outline dense color="primary" icon="skip_next" :label="skipLabel" @click="room.skip()" />
        <q-btn v-if="can.abort" outline dense color="negative" icon="stop" label="중단" @click="confirmAbort" />
        <q-btn flat dense icon="logout" label="나가기" @click="emit('leave')" />
      </div>
    </q-card-section>
  </q-card>
</template>
