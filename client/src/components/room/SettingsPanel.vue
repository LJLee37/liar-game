<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import {
  JUDGE_MODE_DESCRIPTIONS,
  JUDGE_MODE_LABELS,
  LIMITS,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  SETTING_RANGES,
} from '../../../../shared/constants.ts'
import type { GameMode, JudgeMode, RoomSettingsUpdate } from '../../../../shared/protocol.ts'
import { useRoomStore } from '../../stores/room.ts'

const room = useRoomStore()
const { view } = storeToRefs(room)

const r = computed(() => view.value!.room)
const s = computed(() => r.value.settings)
const editable = computed(() => view.value!.can.settings)
const connectedCount = computed(() => r.value.players.filter((p) => p.connected).length)

const modeOptions = (['liar', 'fool'] as GameMode[]).map((m) => ({ value: m, label: MODE_LABELS[m], desc: MODE_DESCRIPTIONS[m] }))
const judgeOptions = (['auto', 'host', 'vote'] as JudgeMode[]).map((m) => ({
  value: m,
  label: JUDGE_MODE_LABELS[m],
  desc: JUDGE_MODE_DESCRIPTIONS[m],
}))
const categoryOptions = computed(() =>
  r.value.categories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name} (${c.wordCount})`.trim() })),
)
const categoryNames = computed(() => {
  if (s.value.categoryIds.length === 0) return '전체 카테고리에서 무작위'
  return s.value.categoryIds.map((id) => r.value.categories.find((c) => c.id === id)?.name ?? id).join(', ')
})

function update(patch: RoomSettingsUpdate) {
  void room.updateSettings(patch)
}

function formatSeconds(sec: number): string {
  return sec >= 60 ? `${Math.floor(sec / 60)}분${sec % 60 ? ` ${sec % 60}초` : ''}` : `${sec}초`
}
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="row items-center">
      <div class="text-subtitle1 text-weight-bold">게임 설정</div>
      <q-space />
      <div v-if="!editable" class="text-caption text-grey">방장만 바꿀 수 있어요</div>
    </q-card-section>

    <q-card-section class="q-pt-none q-gutter-y-md">
      <div>
        <div class="text-subtitle2">모드</div>
        <q-option-group
          v-if="editable"
          :model-value="s.mode"
          :options="modeOptions"
          type="radio"
          @update:model-value="(v: GameMode) => update({ mode: v })"
        >
          <template #label="opt">
            <div>
              <div>{{ opt.label }}</div>
              <div class="text-caption text-grey">{{ opt.desc }}</div>
            </div>
          </template>
        </q-option-group>
        <div v-else class="text-body2">{{ MODE_LABELS[s.mode] }} — {{ MODE_DESCRIPTIONS[s.mode] }}</div>
      </div>

      <div>
        <div class="text-subtitle2">출제 카테고리</div>
        <q-select
          v-if="editable"
          :model-value="s.categoryIds"
          :options="categoryOptions"
          multiple
          use-chips
          emit-value
          map-options
          outlined
          dense
          clearable
          label="비워 두면 전체 카테고리"
          @update:model-value="(v: string[] | null) => update({ categoryIds: v ?? [] })"
        />
        <div v-else class="text-body2">{{ categoryNames }}</div>
      </div>

      <div>
        <div class="text-subtitle2">애매한 정답 판정</div>
        <q-option-group
          v-if="editable"
          :model-value="s.judgeMode"
          :options="judgeOptions"
          type="radio"
          inline
          @update:model-value="(v: JudgeMode) => update({ judgeMode: v })"
        />
        <div class="text-caption text-grey">
          {{ editable ? JUDGE_MODE_DESCRIPTIONS[s.judgeMode] : `${JUDGE_MODE_LABELS[s.judgeMode]} — ${JUDGE_MODE_DESCRIPTIONS[s.judgeMode]}` }}
          정확히 같거나 등록된 다른 표기는 항상 자동 인정돼요.
        </div>
      </div>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-6">
          <div class="text-subtitle2">설명 바퀴 수: {{ s.laps }}바퀴</div>
          <q-btn-toggle
            v-if="editable"
            :model-value="s.laps"
            :options="[1, 2, 3].map((n) => ({ value: n, label: `${n}바퀴` }))"
            unelevated
            toggle-color="primary"
            @update:model-value="(v: number) => update({ laps: v })"
          />
        </div>
        <div class="col-12 col-sm-6">
          <div class="text-subtitle2">최대 인원: {{ r.maxPlayers }}명</div>
          <q-slider
            v-if="editable"
            :model-value="r.maxPlayers"
            :min="Math.max(LIMITS.maxPlayers.min, r.players.length)"
            :max="LIMITS.maxPlayers.max"
            markers
            label
            @change="(v: number) => update({ maxPlayers: v })"
          />
        </div>
        <div class="col-12 col-sm-6">
          <div class="text-subtitle2">설명 제한 시간: {{ formatSeconds(s.hintSeconds) }}</div>
          <q-slider
            v-if="editable"
            :model-value="s.hintSeconds"
            :min="SETTING_RANGES.hintSeconds.min"
            :max="SETTING_RANGES.hintSeconds.max"
            :step="5"
            label
            @change="(v: number) => update({ hintSeconds: v })"
          />
        </div>
        <div class="col-12 col-sm-6">
          <div class="text-subtitle2">토론 시간: {{ formatSeconds(s.discussSeconds) }}</div>
          <q-slider
            v-if="editable"
            :model-value="s.discussSeconds"
            :min="SETTING_RANGES.discussSeconds.min"
            :max="SETTING_RANGES.discussSeconds.max"
            :step="30"
            label
            @change="(v: number) => update({ discussSeconds: v })"
          />
        </div>
      </div>
    </q-card-section>

    <q-separator />
    <q-card-actions align="center" class="q-py-md column items-center">
      <template v-if="view!.me.isHost">
        <q-btn
          unelevated
          color="primary"
          size="lg"
          icon="play_arrow"
          label="게임 시작"
          :disable="!view!.can.start"
          @click="room.start()"
        />
        <div v-if="!view!.can.start" class="text-caption text-grey q-mt-sm">
          접속 중인 플레이어가 {{ LIMITS.minPlayers }}명 이상이어야 해요. (현재 {{ connectedCount }}명)
        </div>
        <q-btn flat dense size="sm" icon="restart_alt" label="점수 초기화" class="q-mt-sm" @click="room.resetScores()" />
      </template>
      <div v-else class="text-body2 text-grey">방장이 게임을 시작할 때까지 기다려 주세요.</div>
    </q-card-actions>
  </q-card>
</template>
