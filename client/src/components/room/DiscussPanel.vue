<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view, round } = storeToRefs(room)

const isReady = computed(() => !!round.value?.ready.includes(view.value!.me.id))
const activeCount = computed(() => (round.value ? round.value.order.length - round.value.left.length : 0))
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-gutter-sm">
      <div class="col text-body2">
        채팅으로 자유롭게 토론하세요. 모두 준비하면 바로 투표로 넘어가요.
      </div>
      <q-btn
        v-if="view!.can.ready"
        :color="isReady ? 'positive' : 'primary'"
        unelevated
        :icon="isReady ? 'check' : 'how_to_vote'"
        :label="isReady ? '준비 완료 (취소)' : '투표 준비'"
        @click="room.setReady(!isReady)"
      />
      <div class="text-caption">준비 {{ round!.ready.length }} / {{ activeCount }}명</div>
    </q-card-section>
  </q-card>
</template>
