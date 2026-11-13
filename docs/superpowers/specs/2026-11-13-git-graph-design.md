# Git Graph for Herdr — 설계

작성일: 2026-11-13

## 왜 만드나

사용자는 지금 VS Code(+ Git Graph 확장)와 에이전트 터미널을 동시에 띄워 놓고 오간다.
목표는 **Herdr 하나로 둘 다 보는 것**. 편집은 이미 herdr-nvim이 맡고 있고, VS Code에서
옮겨오지 못한 마지막 큰 조각이 Git Graph다. VS Code 확장은 웹뷰(HTML/CSS)라 Herdr에
넣을 수 없으므로(`~/.config/herdr-app/AGENTS.md` "You can't"), gpui-kit 네이티브 mod로
**다시 만든다**. 기준은 VS Code Git Graph 확장의 화면과 사용 흐름이다.

성공: VS Code를 열지 않고도 Git Graph에서 하던 일(그래프 보기, 커밋 눌러 diff 보기,
우클릭 git 작업, 상단 바 기능)을 Herdr 안에서 모두 할 수 있다.

## 목표

1. 오른쪽 사이드 패널에 **Files · Changes 옆 세 번째 탭 "Graph"**.
2. 컬러 레인 그래프 + 커밋 목록 + 브랜치/태그/HEAD 라벨 + stash 줄, 맨 위에 **Uncommitted Changes** 줄.
3. 커밋 클릭 → 그 아래 인라인 상세(해시, 작성자, 날짜, 전체 메시지, 변경 파일 목록과 +/-).
4. 파일 클릭 → 작업 영역에 **diff 패널** 하나(재사용).
5. 우클릭 메뉴 7종(커밋, 로컬 브랜치, 현재 브랜치, 원격 브랜치, 태그, Uncommitted Changes, stash): 아래 "우클릭 메뉴" 전부.
6. 상단 바: Branches 드롭다운, Show Remote Branches, 검색(Find), Fetch, 새로고침 — 전부.

## 비목표

- 스테이징/커밋 UI — 기본 `changes` 패널(커밋 메시지 입력 + Commit 버튼)이 맡는다. *(내 판단)*
- VS Code 확장 코드·자산 재사용. 동작과 모양만 참고하고 코드는 새로 쓴다. *(내 판단: Git Graph 확장은 자체 라이선스라 코드를 가져오지 않는다)*
- nvim diff 모드/플러그인 기반 diff. *(사용자와 합의: 설정 따라 달라지고 클릭 감이 약함)*
- GitHub/GitLab API 연동(PR 보기 등).

## 반(反)목표 — 동작해도 실패인 것

- 파괴적 작업(reset --hard, drop, 브랜치 삭제, force)이 **확인 없이** 실행됨.
- 큰 저장소에서 패널이 멈추거나 Herdr 창 전체가 버벅임.
- 새로고침이 `.git`에 무언가를 써서(index lock, fsmonitor 쿠키) 폴더 감시가 무한 새로고침을 부름. `changes`처럼 `--no-optional-locks -c core.fsmonitor=false`로 읽는다.
- 패널이 사용자 테마를 무시하고 따로 놂.

## 화면과 동작

### 배치

- 레이아웃 `panel-body` stack에 `{ "id": "graph", "type": "block", "content": { "mod": "git-graph" } }` 추가.
- 상단 Files/Changes 버튼은 기본 `tabs` mod에 하드코딩되어 있다(`mods/tabs/main.js:109-110`,
  `shared("workspace.panels") ?? ["files","changes"]`). → `tabs`를 복제한 `git-graph-tabs`
  mod에 **Graph 버튼**(아이콘 포함)을 추가하고, 레이아웃에서 `{ "mod": "git-graph-tabs", "props": { "replaces": { "mod": "tabs" } } }`로 바꿔 끼운다(herdr-nvim이 `pane` 헤더를 바꿔 끼운 방식).
- 대상 레이아웃: 사용자가 쓰는 `main-copy.json`. 저장소에는 이 수정본을 `layouts/`로 둔다.

### 어느 저장소를 보여주나

`changes`와 같은 규칙: 포커스된 패널의 cwd → 없으면 focused().cwd → 없으면 space 폴더.
`git rev-parse --show-toplevel`로 루트를 찾고, 저장소가 아니면 "Not a git repository".
다른 머신의 space면 `exec(..., { on })`로 그 머신에서 git을 돌린다.
갱신: 로컬은 `watchFolder(root)` + 10초 타이머(`changes`/`files`와 같음), 원격은 타이머만.
포커스가 다른 저장소로 옮겨가면 그 저장소로 바뀌고, 저장소별 상태(펼친 커밋, 필터, 스크롤)는 기억한다.

### 패널 (Graph 탭)

헤더 (Changes 카드와 같은 모양: 둥근 카드, 테마 색):
- 제목 `Graph` + 현재 브랜치.
- **Branches 드롭다운**: 다중 선택, "Show All" 항목. 선택한 브랜치에서 닿는 커밋만 표시.
- **Show Remote Branches** 체크박스.
- **Find**: 메시지/해시/작성자/브랜치 이름 검색, 일치 강조, 다음/이전 이동(⏎ / ⇧⏎).
- **Fetch** 버튼: `git fetch --all` (prune 안 함 — Git Graph 기본값과 같게. *내 판단*), 진행 중 스피너.
- **새로고침** 버튼.
- 패널이 좁으면 헤더 컨트롤은 아이콘으로 줄인다.

목록:
- **Stash**도 그래프에 표시한다: stash를 만든 커밋에서 가지 친 별도 줄(Git Graph처럼). 클릭하면 커밋처럼 인라인 상세와 파일 목록.
- 맨 위 **Uncommitted Changes** 줄(변경이 있을 때만). 클릭하면 staged/unstaged 파일 목록이 펼쳐지고 파일 클릭 → 작업 트리 diff.
- 각 줄: 그래프 레인 | 라벨(로컬 브랜치, 원격 브랜치, 태그, HEAD) + 메시지 | 작성자 | 날짜 | 짧은 해시.
- **폭에 따라 열이 나타남**: 300px 기본폭에선 그래프 + 라벨 + 메시지만, 넓히면 작성자 → 날짜 → 해시 순으로 추가. *(내 판단: 문턱값은 빌더가 정함)*
- 레인 색은 `theme().ansi1..ansi6` 순환. 선은 `PathBuilder` + `paint_path`.
- 첫 로드 300커밋, 끝까지 스크롤하면 300씩 더. 가상 리스트(`v_virtual_list`). *(내 판단)*
- 머지 커밋은 흐리게(Git Graph처럼). *(내 판단)*

커밋 클릭 → 인라인 상세(다시 클릭하면 접힘, 한 번에 하나):
- 전체 해시(클릭 복사), 부모, 작성자/커미터 + 이메일, 날짜, 전체 메시지.
- 변경 파일 목록: 상태(A/M/D/R), 경로, +/-.
- 파일 클릭 → diff 패널.

키보드(패널이 포커스일 때, `mod.json` `"focusable": true`): ↑/↓ 이동, ⏎ 펼치기, `/` 검색, Esc 접기. *(내 판단: 최소 세트)*

### diff 패널 (작업 영역)

- 파일 클릭 시 `pane.split { direction: "right", mod: "git-graph", props: { diff: {...} } }`로 mod 패널을 연다.
  이미 열려 있으면 **새로 열지 않고 내용만 교체**.
- diff 패널은 **탭마다 하나**. Herdr는 split 후 mod 패널의 props를 바꿀 수 없으므로, 보여줄 대상은
  `shared("git-graph.diff.<tab id>")`로 넘긴다. 클릭한 순간의 탭에 diff 패널이 있으면 그걸 쓰고, 없으면 그 탭에 새로 연다. *(내 판단)*
- 재시작하면 mod 패널은 탭과 함께 복원된다. 복원된 diff 패널은 마지막으로 보던 파일을 다시 보여주고,
  그 커밋/파일이 더 이상 없으면 안내 문구를 띄운다. *(내 판단)*
- 기본 unified, 헤더 버튼으로 좌우(side-by-side) 전환. 선택은 기억.
- 문법 강조는 `EditorState`(readonly) + 테마 ansi 색. 추가/삭제 줄 배경색.
- 헤더: 파일 경로, 커밋 짧은 해시(또는 "Working tree"), 전환 버튼, **"nvim에서 열기"** (herdr-nvim이 있으면 그 탭의 nvim에서 현재 파일을 연다; 없으면 버튼 숨김), 닫기.
- Esc 또는 닫기로 패널 닫힘.
- 바이너리/너무 큰 파일은 안내 문구.

### 우클릭 메뉴

`on_mouse_down("right")` → `openOverlay({ kind: "popup", ... })`로 메뉴(기본 `menu` mod 참고).
"…"이 붙은 항목은 대화상자(기본 `confirm`/`prompt` 참고)로 옵션을 받은 뒤 실행.
옵션과 기본값은 Git Graph 확장과 같게 한다.

**커밋**
- Add Tag… (이름, 주석 태그 여부/메시지, 원격 push 여부)
- Create Branch… (이름, 바로 checkout 여부)
- Checkout… (detached HEAD 확인)
- Cherry Pick… (머지 커밋이면 부모 선택, `--no-commit` 옵션)
- Revert… (머지 커밋이면 부모 선택)
- Drop… (이 커밋을 히스토리에서 제거 — 확인 필수)
- Merge into current branch… (no-ff, squash, no-commit 옵션)
- Rebase current branch on this Commit… (확인)
- Reset current branch to this Commit… (soft / mixed / hard)
- Copy Commit Hash to Clipboard
- Copy Commit Subject to Clipboard

**로컬 브랜치 (체크아웃 안 된 것)**
- Checkout Branch
- Rename Branch…
- Delete Branch… (강제 삭제 옵션)
- Merge into current branch…
- Rebase current branch on Branch…
- Push Branch… (원격 선택, set-upstream, force 옵션)
- Create Archive (zip/tar 저장 위치 선택)
- Unselect in Branches Dropdown
- Copy Branch Name to Clipboard

**현재 체크아웃된 브랜치**: Rename Branch…, Push Branch…, Create Archive, Unselect in Branches Dropdown, Copy Branch Name to Clipboard.

**원격 브랜치** *(항목 구성은 Git Graph 확장 기준 — 내 판단)*
- Checkout Branch… (같은 이름의 로컬 브랜치를 만들어 추적; 이름 수정 가능)
- Delete Remote Branch… (확인 필수)
- Fetch into local branch… (로컬 브랜치 이름, force 옵션)
- Merge into current branch…
- Pull into current branch… (no-ff, squash 옵션)
- Create Archive
- Unselect in Branches Dropdown
- Copy Branch Name to Clipboard

**태그**
- View Details (주석 태그일 때: 태거, 날짜, 메시지)
- Delete Tag… (원격에서도 삭제 옵션)
- Push Tag… (원격 선택)
- Create Archive
- Copy Tag Name to Clipboard

**Uncommitted Changes 줄**
- Stash uncommitted changes… (메시지, untracked 포함 옵션)
- Reset uncommitted changes… (mixed / hard)
- Clean untracked files… (디렉터리 포함 옵션 — 확인 필수)
- Open Changes panel (Git Graph의 "Open Source Control View" 대응: 사이드 패널을 Changes 탭으로)

**Stash 줄**
- Apply Stash… (index 복원 옵션)
- Create Branch from Stash… (이름)
- Pop Stash… (index 복원 옵션)
- Drop Stash… (확인 필수)
- Copy Stash Name to Clipboard
- Copy Stash Hash to Clipboard

복사는 `pbcopy`(macOS) — 다른 OS 대응은 빌더 판단.

### 실행과 결과

- 모든 git 작업은 `exec("git", [...], { cwd: root, on })`.
- 실행 중엔 헤더에 진행 표시, 같은 저장소에 다른 작업 동시 실행 막음.
- 성공 → 그래프 새로고침. 실패 → `notify({ level: "error" })`로 git stderr 표시.
- 충돌(merge/rebase/cherry-pick) → 토스트로 알리고 Uncommitted Changes 줄에 충돌 표시. 충돌 해결 UI는 만들지 않는다(nvim/Changes에서). *(내 판단)*

## 제약

- gpui-kit JS (Herdr 내장 gpui-shell). HTML/CSS/웹뷰/Node API/`setTimeout` 없음. `cx.timer`, `cx.spawn`만.
- `cx`를 보관해 나중에 쓰지 않는다. 애니메이션은 `.frames`/`.spin`/`.loop`, 타이머로 다시 그리지 않는다.
- 색은 전부 `theme()` 이름으로.
- `herdr-app check mods/<name>` 통과 없이는 완료 아님. 화면 확인은 `herdr-app shot`.
- 기본 mod(`tabs`, `menu`, `confirm`, `prompt`)는 직접 고치지 않고 복제하거나 참고만.

## 저장소 구조

Herdr 공유 형식(herdr.dev/mods)과 같은 모양:

```
herdr-git-graph/
├── docs/superpowers/specs/2026-11-13-git-graph-design.md
├── mods/git-graph/        패널, diff 패널, 메뉴, 대화상자 (props로 역할 구분 — herdr-nvim 방식)
├── mods/git-graph-tabs/   Graph 버튼을 넣은 tabs 복제본
├── layouts/main-copy.json graph 블록 + git-graph-tabs 적용본
├── RECIPE.md, preview.png (나중에 공유할 때)
```

개발 중에는 `~/.config/herdr-app/mods/`에 심볼릭 링크로 연결해 바로 확인. Herdr가 링크된
mod 폴더를 인식/핫리로드하는지 **먼저 확인**하고, 안 되면 복사 스크립트로 대체.

## 빌더에게 맡기는 것

- 레인 배치 알고리즘, 파일 나누기, 내부 데이터 구조.
- 열이 나타나는 폭 문턱값, 행 높이, 세부 간격(기존 `changes` 패널과 어울리게).
- git 명령의 정확한 플래그.

## 완료 조건

- `herdr-app check`가 `git-graph`, `git-graph-tabs` 둘 다 통과.
- 상단에 Files · Changes · Graph 버튼, Graph 클릭 시 그래프 표시. 저장소가 아니면 "Not a git repository".
- 이 저장소(`herdr-git-graph`)와 커밋 수천 개짜리 저장소에서 스크롤이 매끄럽다.
- 커밋 클릭 → 인라인 상세, 파일 클릭 → diff 패널 열림, 다른 파일 클릭 → 같은 패널 내용 교체, unified/side-by-side 전환 동작.
- 우클릭 메뉴 7종이 위 목록과 정확히 일치하고, 각 항목이 테스트 저장소에서 실제로 동작한다.
- 파괴적 작업은 전부 확인 대화상자를 거친다.
- Branches 필터, Show Remote Branches, Find, Fetch, 새로고침 동작.
- Uncommitted Changes 줄이 작업 트리 변화를 따라간다.
- 테마를 바꾸면(라이트/다크 포함) 패널이 따라간다.
