<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view, round } = storeToRefs(room)
const vote = computed(() => round.value?.vote ?? null)
const me = computed(() => view.value!.me.id)
const voterCount = computed(() => (round.value ? round.value.order.length - round.value.left.length : 0))
</script>

<template>
  <q-card v-if="vote" flat bordered>
    <q-card-section>
      <div class="text-subtitle1 text-weight-bold">
        {{ vote.round === 1 ? '라이어는 누구일까요?' : '동점! 재투표' }}
      </div>
      <div class="text-caption">
        <template v-if="vote.round === 2">동점인 사람 중에서 다시 골라 주세요. 또 동점이면 라이어가 이겨요. </template>
        투표 {{ vote.voted.length }} / {{ voterCount }}명 · 시간 안에 바꿀 수 있어요
      </div>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="row q-col-gutter-sm">
        <div v-for="id in vote.candidates" :key="id" class="col-6 col-sm-4">
          <q-btn
            class="full-width"
            no-caps
            :unelevated="vote.myVote === id"
            :outline="vote.myVote !== id"
            :color="vote.myVote === id ? 'accent' : 'primary'"
            :disable="!view!.can.vote || id === me"
            @click="room.vote(id, vote.round)"
          >
            <div class="column items-center q-py-xs">
              <div class="text-weight-bold word-break">{{ room.nameOf(id) }}{{ id === me ? ' (나)' : '' }}</div>
              <div v-if="vote.prevTally" class="text-caption">1차 {{ vote.prevTally[id] ?? 0 }}표</div>
              <q-icon v-if="vote.voted.includes(id)" name="check" size="xs">
                <q-tooltip>투표 완료</q-tooltip>
              </q-icon>
            </div>
          </q-btn>
        </div>
      </div>
      <div v-if="!view!.can.vote" class="text-caption text-grey q-mt-sm">관전 중에는 투표할 수 없어요.</div>
    </q-card-section>
  </q-card>
</template>
