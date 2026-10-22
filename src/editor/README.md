# 에디터: 새 오브젝트 타입 추가

1. 게임 쪽: `game.json`의 스테이지에 데이터 필드를 정하고(예: `stage.obstacles = [{x, z, w}]`) `main.js`가 읽도록 만든다 (`sanitizeData` 포함).
2. `src/editor/objectTypes.js`에 정의 하나를 `registerType`으로 등록한다. view/panels/model은 수정하지 않는다.
3. 툴바 추가 버튼, 캔버스 그리기·선택·드래그, 속성 폼, 검증, undo, 저장 보존이 자동으로 따라온다.

```js
registerType({
  id: 'obstacle', label: '장애물', addLabel: '장애물 추가',
  storage: { kind: 'array', key: 'obstacles' }, max: 6,       // 한 개짜리 on/off면 { kind: 'flag', key }
  create: () => ({ x: 0, z: 0, w: 2 }),
  fields: [{ name: 'w', label: '폭', type: 'number', min: 0.5, max: 14, step: 0.5 }],
  describe: (o) => `장애물 w${o.w}`,
  hitTest: (o, x, z) => (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < 0.5 ? { mode: 'move' } : null),
  draw: (dc, o, { selected }) => dc.rect(o.x - o.w / 2, o.z - 0.5, o.x + o.w / 2, o.z + 0.5, '#a55', selected ? '#fff' : null),
  onDrag: (s, d) => ({ x: d.snap(s.x + d.dx), z: d.snap(s.z + d.dz) }),
});
```

선택 항목: `nudge`, `normalize`, `warnings`, `validate`, `notes`, `afterDuplicate` (전체 목록은 objectTypes.js 맨 위 주석). 필드 정의 형식은 `fields.js`. 모르는 키는 에디터가 그대로 보존한다.

# 기본 스테이지 잠금

- 스테이지 1~5(인덱스 0~4)는 읽기 전용이다: 오브젝트 추가/삭제/이동/수정, 스테이지·보스 필드, 삭제, 순서 이동이 막히고(모델이 `false`/`-1` 반환, undo에도 안 쌓임) 복제만 된다. 복제본은 항상 맨 뒤에 추가되며 자유롭게 편집할 수 있다. 전역 수치/적 종류는 잠그지 않는다.
- JSON 불러오기는 인덱스 0~4 스테이지가 현재 데이터와 다르면 거부한다 (같으면 나머지만 반영).
- 백업: `src/data/backup/base-stages.json`(`{createdAt, stages:[5개]}`)은 개발 서버 시작 시 없을 때만 game.json 앞 5개로 한 번 만들고 절대 덮어쓰지 않는다(`GET /api/stage-backup`, 쓰기 API 없음, 갱신하려면 파일을 지우고 서버 재시작). git에 포함한다.
- 해제: 기본 스테이지를 선택하고 `🔓 편집 잠금 해제`(세션 메모리에만 유지, 새로고침하면 다시 잠김). 해제 중에는 내용 편집과 JSON 불러오기(1~5가 달라도)가 되지만 삭제·순서 이동은 계속 막힌다. 저장 시 1~5가 바뀌었으면 확인창이 뜬다.
- 복원: 해제 상태에서 `원본으로 복원`(선택한 스테이지) / `1~5 모두 복원`. undo 가능하며 저장해야 파일에 반영된다.
- `schema.js`의 `LOCKED_STAGE_COUNT`(기본 5)를 `0`으로 바꾸면 잠금이 모두 해제된다.

# 웨이브 섹션 (E4)

- 데이터: 스테이지의 `waves: [{ duration, interval, count, runner?, tank? }]`(1~6개)와 `bossWave: { interval, count, runner?, tank? }`. 모두 선택 필드이고, 없으면 예전 공식(웨이브 3개, 길이=`config.waveDur`, 간격 1초, 개수 `3+2k+stageIdx`, 보스 웨이브 `2+stageIdx`)으로 동작한다. 공식과 범위는 `src/shared/gamedefaults.js` 한 곳에 있고 게임(`sanitizeData`)과 에디터(`schema.js`)가 같이 쓴다. runner/tank를 비우면 스테이지 값을 쓴다.
- 에디터는 필드가 없는 스테이지에 파생 기본값을 보여 주고, 처음 편집할 때 그 스테이지의 데이터에 채운다. 저장(`prepareForSave`)할 때 기본값과 같고 저장된 파일에도 없던 필드는 쓰지 않는다. 그래서 건드리지 않은 스테이지 1~5는 game.json이 바뀌지 않는다. 기본 스테이지 변경 감지·JSON 불러오기 비교(`canonicalStage`)도 같은 규칙이다.
- 행 목록 UI는 `fields.js`의 리스트 폼 정의(`{ name, label, min, max, itemFields, itemLabel, addLabel }`, 예: `schema.js`의 `WAVE_LIST`)와 `panels.js`의 `buildListForm`을 쓴다. 다른 행 목록(예: 적 구성)도 정의 하나와 `model.js`의 추가/삭제 함수만 더하면 된다.
- 새 웨이브 필드 추가: `gamedefaults.js`의 범위/파생값 → `main.js`의 `sanitizeWaves` → `schema.js`의 `WAVE_FIELDS` 순으로 한 항목씩 추가한다.
- 전역 수치 `homingR`, `enemyHomingR`, `homingSlow`도 `config`에 없으면 기본값으로 보이고, 값을 바꿔야 파일에 쓰인다 (반경 상한 4의 이유는 `gamedefaults.js` 주석).

# 배포(정적 호스팅) 모드

에디터(`editor.html`)는 게임(`index.html`)과 함께 빌드되어 GitHub Pages 같은 정적 호스팅에서도 열린다. 빌드는 `base: './'`(상대 경로)라서 `/저장소이름/` 하위 경로에서도 동작하고, 개발 서버는 기존대로 `/`다. 에디터는 `/editor.html` 또는 `<배포주소>/editor.html`로 연다 (게임 화면에는 링크가 없다).

- **모드 판정** (`env.js`): 시작 시 문서 기준 상대 경로로 `GET api/game-data`를 요청해 **200 + Content-Type이 JSON + 본문이 `stages` 배열을 가진 객체**일 때만 서버 저장 가능(`canSave`)으로 본다. HTML 200(SPA 폴백), 404, 네트워크 오류, 형식이 다른 JSON은 모두 불가다. `GET api/stage-backup`도 같은 방식으로 `canBackup`을 정한다. `import.meta.env`는 안내 문구에만 쓰고 판정에는 쓰지 않는다.
- **서버 저장 모드** (`npm run dev`): 지금까지와 같다. 서버 저장, 백업 확인, 원본 복원이 된다. 상단 배지는 `서버 저장 모드`.
- **내려받기 모드** (서버 API 없음): 배지는 `내려받기 모드 (이 브라우저에서만 보입니다)`. 번들된 `game.json`을 기본 데이터로 열어 편집, 검증, 되돌리기, 플레이 테스트, JSON 내려받기/불러오기가 된다. **저장 버튼은 비활성**(서버가 없음)이고 `JSON 내려받기`가 강조된다. 백업이 없으므로 `원본으로 복원`/`1~5 모두 복원`은 비활성이며 이유가 표시된다 (잠금 해제 확인창에는 `백업 없음` 경고가 뜬다).
- **플레이 테스트**: 에디터와 같은 폴더의 게임을 `?draft=1&stage=N`으로 연다. 임시본은 같은 출처의 localStorage(`cannonDefense.draftData`)로 넘기므로 배포 주소에서도 동작한다.
- **자동 임시 저장**: 편집할 때마다(약 0.5초 지연) `localStorage['cannonDefense.editorWork']`에 `{ savedAt, baseHash, data }`를 쓴다. 이 브라우저에만 있는 임시본이지 파일이 아니다(`브라우저 임시 저장됨 · 파일 아님` 표시). 용량 초과/접근 불가이면 상태바에 한 번만 경고하고 편집은 계속된다. 변경이 없으면(저장본과 같으면) 지운다. **서버 저장에 성공했을 때만** 지우며, JSON 내려받기는 파일 보관일 뿐이라 자동 저장본을 지우지 않는다. `임시본 지우기`는 자동 저장본과 플레이 테스트 임시본을 각각 확인창으로 물어 지운다.
- **복구**: 시작 시 저장본이 있고 기본 데이터와 다르면(웨이브 파생값 정규화 후 비교) 상단에 `이전 작업을 복구할까요?` 배너가 뜬다. 결정 전에는 자동 저장이 멈춰 저장본을 덮어쓰지 않는다. `복구`는 수정된 상태(저장 *)로 채우고 되돌리기로 취소할 수 있다. `버리기`는 저장본을 삭제한다. 파싱 실패/구조 불량인 저장본은 무시하고 삭제한다. 모르는 키는 그대로 보존된다.
- **잠금과의 관계**: 잠긴 상태(기본값)에서 복구하면 기본 스테이지 1~5는 현재 데이터를 유지하고 나머지(6번 이후, 전역 수치, 적 종류)만 복구하며, 제외한 스테이지 번호를 알린다. 잠금 해제로 편집했던 1~5를 되살리려면 잠금을 해제한 뒤 내려받은 JSON을 불러온다.
- **GitHub Pages에서 편집한 맵을 게임에 반영하는 절차**: (1) 배포된 `editor.html`에서 편집 → (2) `JSON 내려받기`로 `game.json` 저장 → (3) 저장소의 `src/data/game.json`을 그 파일로 교체 → (4) `npm run build` 후 `dist`를 다시 배포. 배포된 게임은 번들된 `game.json`만 읽으므로 이 절차 전에는 다른 사람에게 보이지 않는다.
