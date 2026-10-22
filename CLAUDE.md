# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Three.js + Vite 기반 3D 디펜스 게임 프로토타입 (Mob Control 계열). 대포로 병사를 쏴서 게이트(`+N`, `×N`)로 병사를 늘리고, 위에서 밀려오는 적을 막는다. 응답과 주석은 한국어로 한다.

## 명령어

- `npm run dev` — 개발 서버 (포트 **5737**, `vite.config.js`의 `strictPort: true`라서 사용 중이면 다른 포트로 넘어가지 않고 실패한다. 다른 개발과 포트가 겹치지 않도록 일부러 바꾼 값이니 임의로 되돌리지 말 것)
- `npm run build` — `dist/`로 프로덕션 빌드 (게임 `index.html` + 에디터 `editor.html`, 상대 경로 `base: './'`라서 GitHub Pages 하위 경로에서도 동작)

린터와 테스트는 설정되어 있지 않다. 동작 확인은 브라우저에서 직접 플레이해서 한다.

## 아키텍처

전체 게임이 `src/main.js` 한 파일이다. 핵심 설계는 **로직은 x-z 평면 2D로 계산하고, 렌더링만 3D로 한다**는 점이다.

- **병사/적은 객체가 아니라 SoA(Structure of Arrays)로 저장한다.** `sx/sz/svx/sGate`, `ex/ez/ehp/etype` 같은 `Float32Array`/`Int16Array`에 인덱스로 접근하고, 개수는 `sCount`/`eCount`로 관리한다. 제거는 마지막 원소를 해당 인덱스로 덮어쓰는 swap-remove(`removeSoldier`, `removeEnemy`)라서 **제거 시 인덱스가 바뀐다.** 루프 안에서 제거하지 말고, 병사는 `dead` 배열에 모았다가 뒤에서부터 제거한다.
- **렌더링은 `InstancedMesh` 두 개**(병사, 적)가 전부다. `render()`가 매 프레임 SoA를 읽어 행렬을 다시 쓰고 `count`를 갱신한다. 최대치(`MAX_SOLDIERS`, `MAX_ENEMIES`)는 인스턴스 버퍼 크기이므로 올리면 메모리도 같이 늘어난다.
- **게이트**는 전장 좌우를 꽉 채우는 벽이다(`rowOf1`/`rowOf2`로 한 줄에 전체 폭 1개 또는 절반 폭 2개). 적이 닿으면 파괴된다(`alive=false`). 병사의 `z`가 게이트 `z`를 가로지르는 프레임에 `x`가 게이트 폭 `g.w` 안인지로 판정한다. 병사별 통과 여부는 `sGate[i * GATE_SLOTS + gi]`에 저장해 같은 게이트를 두 번 통과하지 않게 한다. 게이트가 만든 새 병사는 원본의 통과 플래그를 물려받는다(안 그러면 증식된 병사가 같은 게이트를 다시 통과한다). 이 플래그 복사는 swap-remove **이전**의 원본 인덱스로 해야 한다. 게이트를 `GATE_SLOTS`(4)개보다 많이 추가하려면 상수를 같이 올린다.
- **병사-적 충돌**은 매 프레임 적을 격자(`grid`, 셀 2칸)에 넣고 병사 주변 3×3 셀만 검사한다. 병사 1명이 적 체력 1을 깎고 사라지는 1:1 소모 방식이다. 병사는 반경 `HOMING_R`(3.5) 안의 앞쪽 가장 가까운 적을 향해 좌우로 유도되며(5×5 셀 탐색), 격자는 적 전용이라 옆 구역 x는 격자 범위 밖이다.
- **적도 유도한다(보스 제외).** 적은 `ENEMY_HOMING_R`(3) 안의 앞쪽(대포 쪽) 전장 병사 중 가장 가까운 병사를 향해 좌우로 조향한다(병사용 격자 `sGrid`). 유도 중에는 병사·적 모두 전진 속도가 `HOMING_SLOW`(0.6) 배율이 되고, 좌우 최대 속도는 그 유도 중 전진 속도와 같다(병사 3×0.6=1.8, 적 `baseSpeed × 종류 배율 × 0.6`). 적은 병사·대포를 공격하지 않고, 방어선(`BASE_Z`) 도달 피해와 게이트 파괴만 한다. 보스는 직선으로 내려와 `BASE_Z - 1.2`에서 멈춘다.
- **수치**: `SOLDIER_SPEED`=3, 연사 간격 `FIRE_INTERVALS` 1.00→0.35초(Lv0~5), `MAX_SOLDIERS`=10000, `MAX_ENEMIES`=1500(일반 적은 보스·호위병용 `ENEMY_RESERVE`=16을 남긴 1484까지). 적 속도는 `baseSpeed = 1.0 + 0.06 × stageIdx`, 일반 적 체력은 `round(종류 체력 × (1 + 0.15 × stageIdx))`다. 문서의 "스테이지 N"은 1부터, 코드의 `stageIdx`는 0부터(`stageIdx = N - 1`)이며 수식은 `stageIdx` 기준이다. `SPAWN_MULT`는 적 생성량 배율로 평소 1이다.
- **병사 밀어내기**: `separateSoldiers()`가 매 프레임 이동·게이트 판정 **이전에** 병사끼리(전용 격자 `SEP_CELL` 0.8, 3×3 셀만 검사) 겹침을 밀어내고 위치를 확정한다. 병사당 프레임 이동량 `SEP_MAX_STEP`(0.1)과 이웃 검사 `SEP_MAX_CHECK`(48)로 상한을 둬 밀집해도 발산하지 않는다. 벽 구간에서는 병사 몸이 벽 두께와 겹치지 않게 전장 쪽 `|x| ≤ 6.75`, 옆 구역 쪽 `|x| ≥ 7.75`로 제한하고, 미통과 게이트의 `z`를 넘어 밀리지 않게 막아 통과 누락을 방지한다.
- **재사용 버퍼**: 매 프레임 할당을 피하려고 제거 목록 `deadBuf`와 게이트 증식 버퍼 `spawnX/Z/Vx/Src/Flags`를 고정 타입 배열로 둔다. 병사 상한에서 증식분이 버려지면 `soldierCapT`가 약 1초 동안 HUD에 `병사 N MAX`를 남긴다.
- **이펙트 풀**: 파편 입자는 `FX_MAX`(200) 고정 풀과 `InstancedMesh`(`fxMesh`)를 쓴다. `fxBurst`/`fxGateBreak`가 풀 여유만큼만 만들고(가득 차면 무시), `fxUpdate(dt)`가 상태와 무관하게 매 프레임 이동·swap-remove·행렬 갱신을 한다. 게이트는 파괴 후 `GATE_FADE` 동안 투명해지며 사라지고, 대포가 늘면 초록 입자·팝·발광이 나온다(이미 `MAX_CANNONS`면 금색 입자와 점수 +50).
- **얼음 대포(2번 강화)**: `crystal` 그룹(`ICE_W`=옆 구역 폭 4, `ICE_D`=2.6, `ICE_H`=2.4)이 다음 단계 대포가 갇힌 얼음 박스다. 병사 타격 판정은 이 박스의 직사각형이며 병사를 소모한다. 타격 진행도에 따라 균열 `ICE_CRACKS`(5)단계가 늘고 얼음이 흐려진다. 레벨업 시 `fireLevel`(발사 간격)은 **즉시** 오르지만, `crystalBreak`가 갇힌 대포를 `flyers`(풀)로 날려 보내고 도착하면 `shownLevel`(대포 색·포신 굵기)이 따라 올라간다. 그래서 `shownLevel`은 `fireLevel`보다 잠시 뒤처질 수 있다.
- **월드는 전장 + 좌우 옆 구역 2개**다. 전장(`FIELD_W`)에서만 적이 내려온다. 옆 구역(`LANE_X`, `LANE_W`)은 하나가 2번 강화(크리스털 타격 → 공격속도), 다른 하나가 3번 강화(`대포 +1` 벽이 내려옴, 대포가 닿으면 대포 추가)이며, 어느 쪽이 무엇인지는 스테이지의 `crystalSide`/`itemSide`가 정한다. 대포·병사는 `WORLD_HALF`까지 움직일 수 있다. 전장과 옆 구역 사이에는 벽(`WALL_X`)이 있어 적은 x를 클램프하고 병사는 벽 구간(`z < WALL_END_Z`)에서 넘는 순간 튕겨 나온다. 대포가 건너갈 수 있게 대포 쪽은 비어 있다. **구역 소속은 병사 x로 정한다**: `|x| < WALL_X`면 전장, `|x| > WALL_X`면 옆 구역. 옆 구역 병사는 적을 유도하지 않고, 적도 전장 병사만 유도하며, 벽 뒤(`sz < WALL_END_Z`)의 옆 구역 병사는 적과 충돌하지 않는다.
- **입력**은 대포를 눌러 잡고 드래그하는 방식이다. 대포 여러 대(최대 `MAX_CANNONS`=7)는 `CANNON_OFFSETS[n]`이 정한 원형 밀집 대형(정다각형, 7대는 가운데 1 + 둘레 6)으로 같이 움직이고, 발사·아이템 접촉·렌더링 모두 이 오프셋을 쓴다. 게임 상태는 `ready/play/clear/over/win` 상태 머신이고 `STAGES` 배열이 스테이지 5개의 게이트·보스·옆 구역 배치를 정의한다. 플레이 중이 아닐 때는 오버레이의 스테이지 버튼 1~5나 숫자 키 1~5로 스테이지를 고르고(잠금 없음, `loadStage`가 `ready`로 되돌림), Enter/Space 또는 클릭으로 시작한다(상태 전환 후 400ms 가드). 점수는 `loadStage`마다 0으로 리셋된다(누적 총점 없음, 결정된 사항).
- 좌표계: 적은 `SPAWN_Z`(-16)에서 `BASE_Z`(8)로 내려오며(유도 규칙은 위), 대포는 `CANNON_Z`(9)에서 -z 방향으로 병사를 쏜다. 카메라는 고정 쿼터뷰이며 `fitCamera()`가 화면 비율에 맞춰 월드 폭이 다 보이도록 거리를 조정한다.

## 데이터와 에디터

- **맵·수치는 `src/data/game.json`이 정본이다.** 스테이지(게이트 `{op,val,x,z,w}`, 얼음 대포/대포 추가 벽 구역, 적 비율, 보스, 선택 필드 `waves`/`bossWave`), `enemyTypes`, `config`(병사 속도, 연사 간격, 타격 목표, 유도 반경 등)가 들어 있고 `main.js`의 `sanitizeData`가 검증해 읽는다(범위 밖이면 기본값 + `console.warn`). `waves`가 없으면 기존 공식과 같은 값으로 파생된다(`src/shared/gamedefaults.js`). 월드 치수는 `src/shared/world.js`가 게임·에디터 공용이다. URL `?draft=1`은 브라우저 임시본(`localStorage`)을, `?stage=N`은 시작 스테이지를 지정한다.
- **에디터는 `/editor.html`(`src/editor/`, 구조와 새 오브젝트 추가 방법은 `src/editor/README.md`)**. 오브젝트 종류는 `objectTypes.js` 레지스트리로 등록한다. 기본 스테이지 1~5는 읽기 전용이고(복제는 맨 뒤에 추가), `🔓 편집 잠금 해제` 후 편집하며 삭제·순서 이동은 해제해도 불가다. 원본은 `src/data/backup/base-stages.json`에 있고 서버가 없을 때만 생성하며 덮어쓰지 않는다.
- **저장 방식은 환경별로 다르다.** 개발 서버(`tools/vite-plugin-game-data.js`, `apply:'serve'`)가 있으면 저장 버튼이 `game.json`을 직접 덮어쓴다(영구, 커밋·재배포해야 배포본에 반영). 서버가 없으면(정적 배포) 에디터가 응답 형식을 확인해 `내려받기 모드`로 열리고 JSON 내려받기·불러오기만 쓴다. 편집 내용은 `localStorage['cannonDefense.editorWork']`에 자동 임시 저장되어 새로고침 후 복구할 수 있다(그 브라우저에서만).
- 에디터의 검증 범위 일부(`schema.js`, `objectTypes.js`)는 `sanitizeData`의 복제본이라 게임 쪽 범위를 바꾸면 같이 바꿔야 한다.

## 에이전트 워크플로

`.claude/`에 code-writer → code-verifier → feedback-synthesizer 3단계 에이전트와, Agent 호출 시 요약 파일 저장 지시(`agent-summaries/NN-…md`)를 프롬프트에 덧붙이는 PreToolUse 훅이 있다. 진행 방식과 작업 목록은 `.claude/TODO.md`를 따른다. 요청한 범위만 진행하고, 커밋·push는 요청 전에는 하지 않는다.
