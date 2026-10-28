import { createRouter, createWebHistory } from 'vue-router'
import LobbyPage from './pages/LobbyPage.vue'
import RoomPage from './pages/RoomPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'lobby', component: LobbyPage },
    // 초대 링크: https://주소/room/ABCD
    { path: '/room/:code', name: 'room', component: RoomPage, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
