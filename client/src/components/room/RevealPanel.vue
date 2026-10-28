<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRoomStore } from '../../stores/room.ts'
import SecretCard from './SecretCard.vue'

const room = useRoomStore()
const { view, round } = storeToRefs(room)
const participants = computed(() => round.value?.order ?? [])
</script>

<template>
  <div class="q-gutter-y-md">
    <SecretCard />
    <q-card flat bordered>
      <q-card-section class="row items-center q-gutter-sm">
        <q-btn
          v-if="view!.can.confirm"
          color="primary"
          unelevated
          size="lg"
          icon="check"
          label="확인했어요"
          @click="room.confirmRole()"
        />
        <div v-else-if="view!.me.isParticipant" class="text-body2">다른 사람이 확인할 때까지 기다려 주세요.</div>
        <q-space />
        <div class="text-caption">확인 {{ round!.confirmed.length }} / {{ participants.length }}명</div>
      </q-card-section>
      <q-card-section class="q-pt-none row q-gutter-xs">
        <q-chip
          v-for="id in participants"
          :key="id"
          dense
          :icon="round!.confirmed.includes(id) ? 'check_circle' : 'hourglass_empty'"
          :color="round!.confirmed.includes(id) ? 'positive' : 'grey-4'"
          :text-color="round!.confirmed.includes(id) ? 'white' : 'black'"
          :label="room.nameOf(id)"
        />
      </q-card-section>
    </q-card>
  </div>
</template>
