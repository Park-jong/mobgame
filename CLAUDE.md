# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Three.js + Vite 기반 3D 디펜스 게임 프로토타입 (Mob Control 계열). 대포로 병사를 쏴서 게이트(`+N`, `×N`)로 병사를 늘리고, 위에서 밀려오는 적을 막는다. 응답과 주석은 한국어로 한다.

## 명령어

- `npm run dev` — 개발 서버 (포트 **5737**, `vite.config.js`의 `strictPort: true`라서 사용 중이면 다른 포트로 넘어가지 않고 실패한다. 다른 개발과 포트가 겹치지 않도록 일부러 바꾼 값이니 임의로 되돌리지 말 것)
- `npm run build` — `dist/`로 프로덕션 빌드

린터와 테스트는 설정되어 있지 않다. 동작 확인은 브라우저에서 직접 플레이해서 한다.

## 아키텍처

전체 게임이 `src/main.js` 한 파일이다. 핵심 설계는 **로직은 x-z 평면 2D로 계산하고, 렌더링만 3D로 한다**는 점이다.

- **병사/적은 객체가 아니라 SoA(Structure of Arrays)로 저장한다.** `sx/sz/svx/sGate`, `ex/ez/ehp/etype` 같은 `Float32Array`/`Int16Array`에 인덱스로 접근하고, 개수는 `sCount`/`eCount`로 관리한다. 제거는 마지막 원소를 해당 인덱스로 덮어쓰는 swap-remove(`removeSoldier`, `removeEnemy`)라서 **제거 시 인덱스가 바뀐다.** 루프 안에서 제거하지 말고, 병사는 `dead` 배열에 모았다가 뒤에서부터 제거한다.
- **렌더링은 `InstancedMesh` 두 개**(병사, 적)가 전부다. `render()`가 매 프레임 SoA를 읽어 행렬을 다시 쓰고 `count`를 갱신한다. 최대치(`MAX_SOLDIERS`, `MAX_ENEMIES`)는 인스턴스 버퍼 크기이므로 올리면 메모리도 같이 늘어난다.
- **게이트**는 전장 좌우를 꽉 채우는 벽이다(`rowOf1`/`rowOf2`로 한 줄에 전체 폭 1개 또는 절반 폭 2개). 적이 닿으면 파괴된다(`alive=false`). 병사의 `z`가 게이트 `z`를 가로지르는 프레임에 `x`가 게이트 폭 `g.w` 안인지로 판정한다. 병사별 통과 여부는 `sGate[i * GATE_SLOTS + gi]`에 저장해 같은 게이트를 두 번 통과하지 않게 한다. 게이트가 만든 새 병사는 원본의 통과 플래그를 물려받는다(안 그러면 증식된 병사가 같은 게이트를 다시 통과한다). 이 플래그 복사는 swap-remove **이전**의 원본 인덱스로 해야 한다. 게이트를 `GATE_SLOTS`(4)개보다 많이 추가하려면 상수를 같이 올린다.
- **병사-적 충돌**은 매 프레임 적을 격자(`grid`, 셀 2칸)에 넣고 병사 주변 3×3 셀만 검사한다. 병사 1명이 적 체력 1을 깎고 사라지는 1:1 소모 방식이다. 병사는 반경 `HOMING_R` 안의 앞쪽 가장 가까운 적을 향해 좌우로 유도되며(5×5 셀 탐색), 격자는 적 전용이라 옆 구역 x는 격자 범위 밖이다.
- **월드는 전장 + 좌우 옆 구역 2개**다. 전장(`FIELD_W`)에서만 적이 내려온다. 옆 구역(`LANE_X`, `LANE_W`)은 하나가 2번 강화(크리스털 타격 → 공격속도), 다른 하나가 3번 강화(`대포 +1` 벽이 내려옴, 대포가 닿으면 대포 추가)이며, 어느 쪽이 무엇인지는 스테이지의 `crystalSide`/`itemSide`가 정한다. 대포·병사는 `WORLD_HALF`까지 움직일 수 있다. 전장과 옆 구역 사이에는 벽(`WALL_X`)이 있어 적은 x를 클램프하고 병사는 벽 구간(`z < WALL_END_Z`)에서 넘는 순간 튕겨 나온다. 대포가 건너갈 수 있게 대포 쪽은 비어 있다.
- **입력**은 대포를 눌러 잡고 드래그하는 방식이다. 대포 여러 대(최대 `MAX_CANNONS`=7)는 `CANNON_OFFSETS[n]`이 정한 원형 밀집 대형(정다각형, 7대는 가운데 1 + 둘레 6)으로 같이 움직이고, 발사·아이템 접촉·렌더링 모두 이 오프셋을 쓴다. 게임 상태는 `ready/play/clear/over/win` 상태 머신이고 `STAGES` 배열이 스테이지 5개의 게이트·보스·옆 구역 배치를 정의한다.
- 좌표계: 적은 `SPAWN_Z`(-16)에서 `BASE_Z`(8)로 내려오고, 대포는 `CANNON_Z`(9)에서 -z 방향으로 병사를 쏜다. 카메라는 고정 쿼터뷰이며 `fitCamera()`가 화면 비율에 맞춰 월드 폭이 다 보이도록 거리를 조정한다.

## 에이전트 워크플로

`.claude/`에 code-writer → code-verifier → feedback-synthesizer 3단계 에이전트와, Agent 호출 시 요약 파일 저장 지시(`agent-summaries/NN-…md`)를 프롬프트에 덧붙이는 PreToolUse 훅이 있다. 진행 방식과 작업 목록은 `.claude/TODO.md`를 따른다. 요청한 범위만 진행하고, 커밋·push는 요청 전에는 하지 않는다.
