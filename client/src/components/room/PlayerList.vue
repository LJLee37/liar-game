<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { computed } from 'vue'
import { useRoomStore } from '../../stores/room.ts'

const $q = useQuasar()
const room = useRoomStore()
const { view } = storeToRefs(room)

const players = computed(() => view.value!.room.players)
const inRound = computed(() => {
  const phase = view.value!.room.phase
  return phase !== 'LOBBY' && phase !== 'RESULT'
})

function confirmKick(id: string) {
  $q.dialog({
    title: '내보내기',
    message: `${room.nameOf(id)}님을 방에서 내보낼까요?`,
    cancel: { flat: true, label: '취소' },
    ok: { color: 'negative', label: '내보내기', unelevated: true },
  }).onOk(() => void room.kick(id))
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-pb-sm">
      <div class="text-subtitle1 text-weight-bold">플레이어</div>
      <q-space />
      <div class="text-caption">{{ players.length }} / {{ view!.room.maxPlayers }}명</div>
    </q-card-section>
    <q-list dense>
      <q-item v-for="p in players" :key="p.id">
        <q-item-section avatar>
          <q-avatar size="30px" :color="p.connected ? 'primary' : 'grey-5'" text-color="white">
            {{ p.name.slice(0, 1) }}
          </q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label class="word-break">
            {{ p.name }}
            <span v-if="p.id === view!.me.id" class="text-caption">(나)</span>
            <q-icon v-if="p.isHost" name="workspace_premium" color="amber-8" class="q-ml-xs">
              <q-tooltip>방장</q-tooltip>
            </q-icon>
          </q-item-label>
          <q-item-label caption>
            <span v-if="!p.connected" class="text-negative">연결 끊김</span>
            <span v-else-if="inRound && !p.isParticipant">관전 중</span>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge color="primary" :label="`${p.score}점`" />
        </q-item-section>
        <q-item-section v-if="view!.can.kick && p.id !== view!.me.id" side>
          <q-btn flat dense round icon="more_vert" size="sm">
            <q-menu auto-close>
              <q-list dense style="min-width: 140px">
                <q-item clickable :disable="!p.connected" @click="room.transferHost(p.id)">
                  <q-item-section>방장 넘기기</q-item-section>
                </q-item>
                <q-item clickable class="text-negative" @click="confirmKick(p.id)">
                  <q-item-section>내보내기</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>
