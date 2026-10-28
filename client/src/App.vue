<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRoomStore } from './stores/room.ts'

const room = useRoomStore()
const { connected } = storeToRefs(room)
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title class="cursor-pointer" @click="$router.push('/')">🤥 라이어 게임</q-toolbar-title>
        <q-chip
          v-if="!connected"
          dense
          color="negative"
          text-color="white"
          icon="wifi_off"
          label="재연결 중…"
        />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
