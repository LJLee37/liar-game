<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LIMITS, MODE_LABELS } from '../../../shared/constants.ts'
import type { JoinedRoom } from '../../../shared/protocol.ts'
import CreateRoomDialog from '../components/lobby/CreateRoomDialog.vue'
import { useLobbyStore } from '../stores/lobby.ts'
import { useRoomStore } from '../stores/room.ts'
import { useSessionStore } from '../stores/session.ts'

const $q = useQuasar()
const router = useRouter()
const lobby = useLobbyStore()
const room = useRoomStore()
const session = useSessionStore()
const { rooms, loaded } = storeToRefs(lobby)

const nickname = ref(session.nickname)
const codeInput = ref('')
const showCreate = ref(false)
const lastRoom = ref<JoinedRoom | null>(null)

const nicknameValid = computed(() => {
  const len = [...nickname.value.trim()].length
  return len >= LIMITS.playerName.min && len <= LIMITS.playerName.max
})

onMounted(async () => {
  lobby.subscribe()
  // 참가 중이던 방이 아직 있으면 "돌아가기" 버튼을 보여 준다
  const saved = room.identity ?? session.lastRoom()
  if (saved) {
    const res = await lobby.peek(saved.code)
    if (res.ok) lastRoom.value = saved
    else if (res.error === 'NOT_FOUND') session.clearIdentity(saved.code)
  }
})
onBeforeUnmount(() => lobby.unsubscribe())

function saveNickname(): boolean {
  if (!nicknameValid.value) {
    $q.notify({ type: 'warning', message: `닉네임을 ${LIMITS.playerName.min}~${LIMITS.playerName.max}자로 입력해 주세요.` })
    return false
  }
  session.setNickname(nickname.value.trim())
  return true
}

function openCreate() {
  if (saveNickname()) showCreate.value = true
}

function enterRoom(code: string) {
  if (!saveNickname()) return
  void router.push({ name: 'room', params: { code: code.trim().toUpperCase() } })
}

function enterByCode() {
  const code = codeInput.value.trim()
  if (!code) return
  enterRoom(code)
}

async function backToLastRoom() {
  const saved = lastRoom.value
  if (!saved) return
  // 이 탭에 신원이 없으면(탭을 닫았다 연 경우) 저장된 신원을 이 탭으로 가져온다
  if (!session.identityFor(saved.code)) session.saveIdentity(saved)
  void router.push({ name: 'room', params: { code: saved.code } })
}
</script>

<template>
  <q-page padding class="max-width">
    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-4">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-h6">닉네임</div>
            <q-input
              v-model="nickname"
              outlined
              dense
              :maxlength="LIMITS.playerName.max"
              counter
              placeholder="친구들에게 보일 이름"
              @blur="nicknameValid && saveNickname()"
            />
          </q-card-section>
          <q-card-section class="column q-gutter-y-sm">
            <q-btn color="primary" icon="add" label="방 만들기" unelevated @click="openCreate" />
            <q-input
              v-model="codeInput"
              outlined
              dense
              placeholder="방 코드 (예: ABCD)"
              maxlength="4"
              input-class="text-uppercase"
              @keydown.enter="enterByCode"
            >
              <template #append>
                <q-btn flat dense icon="login" label="입장" @click="enterByCode" />
              </template>
            </q-input>
          </q-card-section>
          <q-card-section v-if="lastRoom" class="q-pt-none">
            <q-btn
              outline
              color="secondary"
              icon="replay"
              class="full-width"
              :label="`참가 중이던 방(${lastRoom.code})으로 돌아가기`"
              @click="backToLastRoom"
            />
          </q-card-section>
        </q-card>

        <q-card flat bordered class="q-mt-md">
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-xs">게임 방법</div>
            <ol class="q-pl-md q-my-none text-body2 word-break">
              <li>모두 같은 제시어를 받고, 라이어 한 명만 모릅니다.</li>
              <li>순서대로 제시어를 한 줄로 설명합니다. (너무 쉽게 말하면 라이어가 눈치채요!)</li>
              <li>토론 후 라이어라고 생각하는 사람에게 투표합니다.</li>
              <li>라이어가 지목되면 마지막으로 제시어를 맞힐 기회가 있습니다.</li>
            </ol>
            <div class="text-caption text-grey q-mt-sm word-break">
              바보 모드에서는 라이어도 비슷한 다른 제시어를 받아서, 자신이 라이어인지 모릅니다.
            </div>
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-8">
        <q-card flat bordered>
          <q-card-section class="row items-center">
            <div class="text-h6">방 목록</div>
            <q-space />
            <div class="text-caption text-grey">공개 방만 보여요. 비공개 방은 코드로 입장하세요.</div>
          </q-card-section>
          <q-separator />
          <q-list separator>
            <q-item v-if="!loaded">
              <q-item-section class="text-grey">불러오는 중…</q-item-section>
            </q-item>
            <q-item v-else-if="rooms.length === 0">
              <q-item-section class="text-grey">아직 열린 방이 없어요. 첫 방을 만들어 보세요!</q-item-section>
            </q-item>
            <q-item v-for="r in rooms" :key="r.code" clickable @click="enterRoom(r.code)">
              <q-item-section avatar>
                <q-avatar :color="r.playing ? 'grey-6' : 'primary'" text-color="white" icon="groups" />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium word-break">
                  {{ r.name }}
                  <q-icon v-if="r.hasPassword" name="lock" size="xs" class="q-ml-xs" />
                </q-item-label>
                <q-item-label caption>방장 {{ r.hostName }} · {{ MODE_LABELS[r.mode] }} · 코드 {{ r.code }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge :color="r.playing ? 'grey-7' : 'positive'" :label="r.playing ? '게임 중' : '대기 중'" />
                <div class="text-caption q-mt-xs">{{ r.playerCount }} / {{ r.maxPlayers }}명</div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>
    </div>

    <CreateRoomDialog v-model="showCreate" />
  </q-page>
</template>
