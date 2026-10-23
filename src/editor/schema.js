// 스테이지/보스/전역 수치/적 종류 폼 정의. 범위는 main.js의 sanitizeData와 같다(바꿀 때 같이 바꿀 것).
import { SPAWN_Z, BASE_Z } from '../shared/world.js';
import { MAX_WAVES, WAVE_LIMITS, HOMING_DEFAULTS, HOMING_LIMITS } from '../shared/gamedefaults.js';

export const MAX_STAGES = 9;
// 기본 스테이지 잠금: 인덱스 0~(N-1) 스테이지는 수정·삭제·순서 이동 불가(복제만 가능). 0이면 잠금 해제.
export const LOCKED_STAGE_COUNT = 5;
export const ETYPE_COUNT = 4; // 일반병, 러너, 탱커, 보스 (코드 고정)
export const ETYPE_NAMES = ['일반병', '러너', '탱커', '보스'];

export const STAGE_FIELDS = [
  { name: 'desc', label: '설명', type: 'text', multiline: true },
  { name: 'runner', label: '러너 비율', type: 'number', min: 0, max: 1, step: 0.05 },
  { name: 'tank', label: '탱커 비율', type: 'number', min: 0, max: 1, step: 0.05 },
];

export const BOSS_FIELDS = [
  { name: 'name', label: '이름', type: 'text' },
  { name: 'hp', label: '체력', type: 'number', min: 1, max: 1000000, step: 1 },
  { name: 'speed', label: '속도', type: 'number', min: 0, max: 50, step: 0.05 },
  { name: 'dmg', label: '기지 피해', type: 'number', min: 0, max: 100000, step: 1 },
  {
    name: 'escort', label: '호위병 수', type: 'number', min: 0, max: 8, step: 1, int: true,
    get: (b) => b.escort ?? 0,
    set: (b, v) => { if (v === 0) delete b.escort; else b.escort = v; },
  },
  {
    name: 'summon', label: '소환 간격(초, 0=없음)', type: 'number', min: 0, max: 600, step: 0.5,
    get: (b) => b.summon ?? 0,
    set: (b, v) => { if (v === 0) delete b.summon; else b.summon = v; },
    check: (v) => (v === 0 || (v >= 0.5 && v <= 600) ? null : '0(없음) 또는 0.5~600이어야 합니다'),
  },
];

// ---- 웨이브 (스테이지의 waves 배열 / bossWave 객체). 범위는 shared/gamedefaults.js = main.js sanitizeData와 같다 ----
// runner/tank는 선택값: 비우면 스테이지의 러너/탱커 비율을 쓴다
const optRatio = (name, label) => ({
  name, label, type: 'number', min: WAVE_LIMITS.ratio[0], max: WAVE_LIMITS.ratio[1], step: 0.05, optional: true,
  get: (w) => w[name],
  set: (w, v) => { if (Number.isFinite(v)) w[name] = v; else delete w[name]; },
});
export const WAVE_FIELDS = [
  { name: 'duration', label: '길이(초)', type: 'number', min: WAVE_LIMITS.duration[0], max: WAVE_LIMITS.duration[1], step: 1 },
  { name: 'interval', label: '간격(초)', type: 'number', min: WAVE_LIMITS.interval[0], max: WAVE_LIMITS.interval[1], step: 0.1 },
  { name: 'count', label: '수/회', type: 'number', min: WAVE_LIMITS.count[0], max: WAVE_LIMITS.count[1], step: 1, int: true },
  optRatio('runner', '러너'),
  optRatio('tank', '탱커'),
];
export const BOSSWAVE_FIELDS = WAVE_FIELDS.filter((f) => f.name !== 'duration'); // 보스 웨이브는 보스 처치까지 계속이라 길이 없음
// 리스트 폼 정의 (fields.js의 validateList / panels.js의 buildListForm이 쓴다)
export const WAVE_LIST = {
  name: 'waves', label: '일반 웨이브', min: 1, max: MAX_WAVES, itemFields: WAVE_FIELDS,
  itemLabel: (i) => `웨이브 ${i + 1}`, addLabel: '웨이브 추가',
};

// 전역 수치. homing* 은 game.json에 없으면 기본값(예전 코드 값)으로 보이고, 값을 바꿔야 파일에 쓰인다
const withDefault = (name) => ({ get: (c) => c[name] ?? HOMING_DEFAULTS[name] });
export const CONFIG_FIELDS = [
  { name: 'soldierSpeed', label: '병사 속도', type: 'number', min: 0.1, max: 50, step: 0.1 },
  { name: 'fireIntervals', label: '발사 간격(Lv0~5, 초)', type: 'numlist', length: 6, min: 0.02, max: 60, step: 0.01 },
  { name: 'hitTargets', label: '필요 타격 수(Lv0~4)', type: 'numlist', length: 5, min: 1, max: 100000, step: 1, int: true },
  { name: 'baseHp', label: '기지 HP', type: 'number', min: 1, max: 100000, step: 1 },
  { name: 'waveDur', label: '웨이브 길이(초)', type: 'number', min: 1, max: 600, step: 1 },
  { name: 'itemInterval', label: '대포 추가 벽 간격(초)', type: 'number', min: 0.5, max: 600, step: 0.1 },
  { name: 'itemFirstDelay', label: '첫 대포 추가 벽까지(초)', type: 'number', min: 0, max: 600, step: 0.5 },
  { name: 'crystalZ', label: '얼음 대포 z', type: 'number', min: SPAWN_Z, max: BASE_Z, step: 0.1 },
  // 반경 상한 4: 격자(셀 2칸) 5x5 탐색이 놓치지 않는 한계 (shared/gamedefaults.js 참고)
  { name: 'homingR', label: '병사 유도 반경', type: 'number', min: HOMING_LIMITS.homingR[0], max: HOMING_LIMITS.homingR[1], step: 0.1, ...withDefault('homingR') },
  { name: 'enemyHomingR', label: '적 유도 반경', type: 'number', min: HOMING_LIMITS.enemyHomingR[0], max: HOMING_LIMITS.enemyHomingR[1], step: 0.1, ...withDefault('enemyHomingR') },
  { name: 'homingSlow', label: '유도 중 감속 배율', type: 'number', min: HOMING_LIMITS.homingSlow[0], max: HOMING_LIMITS.homingSlow[1], step: 0.05, ...withDefault('homingSlow') },
];

export const ETYPE_FIELDS = [
  { name: 'name', label: '이름', type: 'text' },
  { name: 'hp', label: '체력', type: 'number', min: 0, max: 100000, step: 1 },
  { name: 'speed', label: '속도', type: 'number', min: 0, max: 50, step: 0.05 },
  { name: 'r', label: '반경 r', type: 'number', min: 0.05, max: 10, step: 0.05 },
  { name: 'scale', label: '크기', type: 'number', min: 0.1, max: 20, step: 0.1 },
  { name: 'dmg', label: '기지 피해', type: 'number', min: 0, max: 100000, step: 1 },
  { name: 'score', label: '점수', type: 'number', min: 0, max: 1000000, step: 1 },
  { name: 'color', label: '색', type: 'color' },
];
