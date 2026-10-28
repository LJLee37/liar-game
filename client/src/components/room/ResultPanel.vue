<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { JUDGE_METHOD_TEXT, JUDGE_REASON_TEXT, RESULT_TEXT } from '../../labels.ts'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view, round } = storeToRefs(room)
const result = computed(() => round.value?.result ?? null)

const bannerClass = computed(() => {
  if (!result.value || result.value.winner === null) return 'bg-grey-6 text-white'
  return result.value.winner === 'liar' ? 'bg-accent text-white' : 'bg-positive text-white'
})

const voteRounds = computed(() => {
  const votes = result.value?.votes ?? []
  return ([1, 2] as const)
    .map((n) => ({ n, votes: votes.filter((v) => v.round === n) }))
    .filter((r) => r.votes.length > 0)
})

const deltas = computed(() =>
  Object.entries(result.value?.scoreDelta ?? {}).map(([id, d]) => ({ id, name: room.nameOf(id), d })),
)
</script>

<template>
  <q-card v-if="result" flat bordered>
    <q-card-section :class="bannerClass" class="text-center">
      <div class="text-h5 text-weight-bold">
        {{ result.winner === 'liar' ? '라이어 승리!' : result.winner === 'citizens' ? '시민 승리!' : '라운드 중단' }}
      </div>
      <div class="text-body2 q-mt-xs">{{ RESULT_TEXT[result.reason] }}</div>
    </q-card-section>

    <q-card-section>
      <div class="row q-col-gutter-md text-center">
        <div class="col">
          <div class="text-caption">라이어</div>
          <div class="text-h6 text-weight-bold">{{ room.nameOf(result.liarId) }}</div>
        </div>
        <div class="col">
          <div class="text-caption">시민 제시어</div>
          <div class="text-h6 text-weight-bold">{{ result.citizenWord }}</div>
        </div>
        <div v-if="result.liarWord" class="col">
          <div class="text-caption">라이어가 받은 단어</div>
          <div class="text-h6 text-weight-bold">{{ result.liarWord }}</div>
        </div>
      </div>
      <div v-if="result.accusedId && result.accusedId !== result.liarId" class="text-center q-mt-sm text-body2">
        지목된 사람: {{ room.nameOf(result.accusedId) }} (시민)
      </div>
    </q-card-section>

    <q-card-section v-if="result.judgement" class="q-pt-none">
      <q-separator class="q-mb-sm" />
      <div class="text-subtitle2">라이어의 정답 도전</div>
      <div class="text-body2">
        “{{ result.judgement.guess || '(입력 없음)' }}” →
        <b :class="result.judgement.accepted ? 'text-positive' : 'text-negative'">
          {{ result.judgement.accepted ? '정답 인정' : '오답' }}
        </b>
      </div>
      <div class="text-caption text-grey">
        {{ JUDGE_METHOD_TEXT[result.judgement.method] }} · {{ JUDGE_REASON_TEXT[result.judgement.reason] }}
        <template v-if="result.judgement.reason === 'similar' || result.judgement.reason === 'different'">
          · 유사도 {{ Math.round(result.judgement.similarity * 100) }}%
        </template>
        <template v-if="result.judgement.timedOut"> · 시간 초과로 자동 판정</template>
      </div>
      <div v-if="result.judgeVotes.length" class="row q-gutter-xs q-mt-xs">
        <q-chip
          v-for="jv in result.judgeVotes"
          :key="jv.judgeId"
          dense
          :color="jv.accept ? 'positive' : 'negative'"
          text-color="white"
          :label="`${room.nameOf(jv.judgeId)}: ${jv.accept ? '인정' : '불인정'}`"
        />
      </div>
    </q-card-section>

    <q-card-section v-if="voteRounds.length" class="q-pt-none">
      <q-separator class="q-mb-sm" />
      <div v-for="vr in voteRounds" :key="vr.n" class="q-mb-xs">
        <div class="text-subtitle2">{{ vr.n === 1 ? '투표' : '재투표' }}</div>
        <div class="row q-gutter-xs">
          <q-chip
            v-for="v in vr.votes"
            :key="v.voterId"
            dense
            outline
            :label="`${room.nameOf(v.voterId)} → ${room.nameOf(v.targetId)}`"
          />
        </div>
      </div>
    </q-card-section>

    <q-card-section v-if="deltas.length" class="q-pt-none">
      <div class="row q-gutter-xs">
        <q-chip v-for="d in deltas" :key="d.id" dense color="primary" text-color="white" :label="`${d.name} +${d.d}`" />
      </div>
    </q-card-section>

    <q-card-actions align="center" class="q-pb-md">
      <template v-if="view!.me.isHost">
        <q-btn
          unelevated
          color="primary"
          size="lg"
          icon="replay"
          label="다음 라운드"
          :disable="!view!.can.start"
          @click="room.start()"
        />
        <q-btn outline color="primary" icon="settings" label="대기실(설정)로" @click="room.toLobby()" />
      </template>
      <div v-else class="text-caption text-grey">방장이 다음 라운드를 시작할 때까지 기다려 주세요.</div>
    </q-card-actions>
  </q-card>
</template>
