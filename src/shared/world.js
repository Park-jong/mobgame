// 월드 치수 상수: 게임(main.js)과 에디터(src/editor)가 같이 쓴다. DOM·three.js 의존 없음.
export const FIELD_W = 7;          // 전장: x -7 ~ 7 (적이 내려오는 곳)
export const LANE_GAP = 0.5;       // 전장과 옆 구역 사이 간격
export const LANE_W = 4;           // 옆 독립 구역 폭
export const LANE_X = FIELD_W + LANE_GAP + LANE_W / 2;   // 옆 구역 중심 (왼쪽 -, 오른쪽 +)
export const WORLD_HALF = FIELD_W + LANE_GAP + LANE_W;   // 대포·병사가 갈 수 있는 x 한계
export const SPAWN_Z = -16;        // 병사 소멸/격자 기준선 (적 생성 위치는 ENEMY_SPAWN_Z)
export const ENEMY_SPAWN_Z = -25;  // 적 생성 위치: 맵(바닥) 끝. 병사는 SPAWN_Z - 3까지만 가서 이 위의 적은 내려오기 전까지 맞출 수 없다
export const BASE_Z = 8;           // 방어선
export const CANNON_Z = 9;
export const GATE_SLOTS = 4;
export const WALL_X = FIELD_W + LANE_GAP / 2;   // 전장과 옆 구역 사이 벽
export const WALL_END_Z = 6;                    // 벽 구간 끝 (z < WALL_END_Z 에만 벽이 있다)
