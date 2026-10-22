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
