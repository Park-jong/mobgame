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
export const HOMING_LIMITS = { homingR: [0.5, 4], enemyHomingR: [0.5, 4], homingSlow: [0.1, 1] };

// ---- 파생 기본값: 필드가 없을 때 예전 공식과 완전히 같은 값 ----
// stageIdx는 0부터. 일반 웨이브 k(0부터): 개수 3 + 2k + stageIdx, 간격 1.0초, 길이 waveDur
export const deriveWave = (k, stageIdx, waveDur) => ({
  duration: waveDur, interval: DEFAULT_WAVE_INTERVAL, count: 3 + k * 2 + stageIdx,
});
export const deriveWaves = (stageIdx, waveDur) => [0, 1, 2].map((k) => deriveWave(k, stageIdx, waveDur));
// 보스 웨이브: 개수 2 + stageIdx, 간격 1.0초
export const deriveBossWave = (stageIdx) => ({ interval: DEFAULT_WAVE_INTERVAL, count: 2 + stageIdx });
