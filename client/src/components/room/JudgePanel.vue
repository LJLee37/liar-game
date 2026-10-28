<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view, round } = storeToRefs(room)
const judge = computed(() => round.value?.judge ?? null)
</script>

<template>
  <q-card v-if="judge" flat bordered>
    <q-card-section>
      <div class="text-subtitle1 text-weight-bold">정답으로 인정할까요?</div>
      <div class="text-caption">
        {{ judge.method === 'host' ? '방장이 판정해요.' : `시민들이 투표로 정해요. (${judge.voted.length} / ${judge.judgeIds.length}명)` }}
        시간이 지나면 자동 판정 제안을 따라요.
      </div>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="row q-col-gutter-md text-center">
        <div class="col">
          <div class="text-caption">라이어의 답</div>
          <div class="text-h5 text-weight-bold word-break">“{{ round!.guess }}”</div>
        </div>
        <div v-if="judge.answer" class="col">
          <div class="text-caption">제시어</div>
          <div class="text-h5 text-weight-bold word-break">{{ judge.answer }}</div>
        </div>
      </div>
      <div class="text-center q-mt-sm text-body2">
        글자 유사도 {{ Math.round(judge.similarity * 100) }}% · 자동 판정 제안:
        <b :class="judge.suggestion === 'accept' ? 'text-positive' : 'text-negative'">
          {{ judge.suggestion === 'accept' ? '인정' : '불인정' }}
        </b>
      </div>
    </q-card-section>
    <q-card-actions v-if="view!.can.judge" align="center" class="q-pb-md">
      <q-btn
        unelevated
        size="lg"
        icon="check"
        label="인정"
        :color="judge.myVote === true ? 'positive' : 'grey-6'"
        @click="room.judge(true)"
      />
      <q-btn
        unelevated
        size="lg"
        icon="close"
        label="불인정"
        :color="judge.myVote === false ? 'negative' : 'grey-6'"
        @click="room.judge(false)"
      />
    </q-card-actions>
    <q-card-section v-else class="text-center text-caption text-grey">판정을 기다리는 중…</q-card-section>
  </q-card>
</template>
