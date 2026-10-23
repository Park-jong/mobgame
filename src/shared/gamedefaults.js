// 게임(main.js의 sanitizeData)과 에디터(schema.js, model.js)가 함께 쓰는 웨이브·유도 기본값과 범위.
// 여기를 바꾸면 양쪽에 같이 적용된다. 웨이브 필드가 없는 스테이지는 deriveWaves가 만든 값(= 예전 고정 공식)으로 동작한다.

export const MAX_WAVES = 6; // 스테이지당 일반 웨이브 최대 개수 (보스 웨이브는 별도 1개)

// [최소, 최대]
export const WAVE_LIMITS = {
  duration: [1, 300],  // 초
  interval: [0.1, 30], // 초 (생성 간격)
  count: [0, 500],     // 정수, 한 번에 생성하는 수
  ratio: [0, 1],       // runner / tank 비율
};

export const DEFAULT_WAVE_INTERVAL = 1.0;

// 유도 반경·감속 기본값(예전 코드 상수)과 범위.
// 반경 상한 4: 유도 탐색은 격자(셀 2칸)에서 병사/적 주변 5x5 셀(±2칸)만 훑는다.
// 대상이 같은 셀 안에서 최대 2 미만 떨어진 위치에 있어도 반경 R 안이면 셀 차이는 floor((2 + R) / 2) 이하라서
// R < 4 이면 ±2칸을 넘지 않고, R = 4 까지는 안전하다. 그보다 크면 반경 안의 대상을 놓치므로 4로 제한한다.
// (격자 크기 CELL이나 탐색 범위를 바꾸면 이 상한도 같이 바꿀 것)
export const HOMING_DEFAULTS = { homingR: 3.5, enemyHomingR: 3, homingSlow: 0.6 };
// homingR / enemyHomingR = 0 이면 병사 / 적은 유도하지 않고 직선으로만 움직인다
export const HOMING_LIMITS = { homingR: [0, 4], enemyHomingR: [0, 4], homingSlow: [0.1, 1] };

// 스테이지가 자기 값으로 덮어쓸 수 있는 config 키 (stage.config). 없으면 전역 config 값. waveDur는 웨이브 기본값 파생에만 쓰이는 전역 값이라 제외
export const STAGE_CONFIG_KEYS = [
  'soldierSpeed', 'fireIntervals', 'hitTargets', 'baseHp', 'itemInterval', 'itemFirstDelay', 'crystalZ',
  'homingR', 'enemyHomingR', 'homingSlow',
];

// ---- 무한 모드 (스테이지의 선택 객체 endless) ----
// 시간 t(초)에 따라: 한 번에 나오는 수가 countStart → countEnd로 rampSec 동안 늘고, 러너/탱커는 각각 runnerStart/tankStart 이후
// rampSec 동안 0 → 최대 비율로 늘며, 일반 적 체력 배율 1 + hpPerMin × 분, 적 속도 + speedPerMin × 분(상한 ENDLESS_SPEED_CAP).
// 보스는 bossFirst초에 처음 나오고 bossEvery초마다 나오며, n번째(0부터) 보스 체력 = 스테이지 boss.hp × bossHpGrowth^n (상한 ENDLESS_BOSS_HP_CAP)
export const ENDLESS_DEFAULTS = {
  rampSec: 150, countStart: 6, countEnd: 30, interval: 0.8,
  runnerStart: 20, runnerMax: 0.3, tankStart: 50, tankMax: 0.2,
  hpPerMin: 0.25, speedPerMin: 0.04,
  bossFirst: 180, bossEvery: 60, bossHpGrowth: 1.5,
};
// [최소, 최대]
export const ENDLESS_LIMITS = {
  rampSec: [10, 3600], countStart: [1, 500], countEnd: [1, 500], interval: [0.1, 30],
  runnerStart: [0, 3600], runnerMax: [0, 1], tankStart: [0, 3600], tankMax: [0, 1],
  hpPerMin: [0, 10], speedPerMin: [0, 1],
  bossFirst: [10, 7200], bossEvery: [10, 3600], bossHpGrowth: [1, 5],
};
export const ENDLESS_INT_KEYS = ['countStart', 'countEnd'];
export const ENDLESS_SPEED_CAP = 0.6;       // 적 기본 속도에 더해지는 증가분 상한
export const ENDLESS_BOSS_HP_CAP = 100000000; // 보스 체력 상한 (Int32 배열 안)

// ---- 파생 기본값: 필드가 없을 때 예전 공식과 완전히 같은 값 ----
// stageIdx는 0부터. 일반 웨이브 k(0부터): 개수 3 + 2k + stageIdx, 간격 1.0초, 길이 waveDur
export const deriveWave = (k, stageIdx, waveDur) => ({
  duration: waveDur, interval: DEFAULT_WAVE_INTERVAL, count: 3 + k * 2 + stageIdx,
});
export const deriveWaves = (stageIdx, waveDur) => [0, 1, 2].map((k) => deriveWave(k, stageIdx, waveDur));
// 보스 웨이브: 개수 2 + stageIdx, 간격 1.0초
export const deriveBossWave = (stageIdx) => ({ interval: DEFAULT_WAVE_INTERVAL, count: 2 + stageIdx });
