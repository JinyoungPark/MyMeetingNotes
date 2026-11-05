# 회의록 (MeetingNotes)

회의를 녹음하면 이 PC 안에서 받아쓰고, 내 AI 구독(Claude·ChatGPT)으로 요약·결정 사항·할 일을 정리해
양식대로 보관하고 워드·PDF·메일로 내보내는 설치형 앱입니다 (맥·윈도우, Electron).

## 하는 일

| 단계 | 어떻게 |
|---|---|
| 기본 정보 | 날짜·시간·장소·작성자·참석자·안건을 양식에 적는다 |
| 녹음 | 마이크로 녹음 (일시 정지 가능). 5초마다 파일에 이어 저장해서 앱이 꺼져도 그때까지는 남는다. Teams 녹화 등 기존 파일도 불러올 수 있다 |
| 받아쓰기 | Whisper 모델을 PC에서 실행 (처음 한 번 내려받기, 이후 인터넷 불필요). 30초 구간마다 `[시:분:초]` 시각을 붙인다. 녹음을 멈추면 바로 시작 |
| AI 정리 | 이미 로그인해 둔 Claude Code 또는 Codex를 실행해 요약·결정 사항·할 일(담당·기한)을 채운다. AI에게 도구는 하나도 주지 않는다 |
| 보관·검색 | 회의 하나 = 폴더 하나 (`meeting.json` + 녹음). 제목·참석자·내용 어디든 검색 |
| 내보내기·공유 | 워드(.docx), PDF, 마크다운, 메일(기본 메일 프로그램에 새 메일), 글로 복사(Teams·메신저) |
| AI 계정 | 설정 → AI 계정에서 Claude·ChatGPT로 로그인. 공식 프로그램이 없으면 앱이 받아 설치하고 각 회사의 공식 로그인 화면을 연다. 비밀번호·토큰은 이 앱이 저장하지 않는다 |
| 새 버전 | GitHub 최신 릴리스 번호를 확인해 왼쪽 아래에 알림. 윈도우 zip판은 ‘지금 업데이트’로 받아 풀고, 다시 시작하면 새 버전이 앱 폴더 파일을 바꿔 끼운다 (막히면 되돌리고 직접 받기 안내) |

## 실행

- 개발 중: Finder에서 `start.command`를 두 번 누르거나, `npm start`
- 시험: `npm test` (맥 음성으로 만든 한국어 녹음으로 받아쓰기 → AI 정리 → 내보내기까지 확인. `MN_SKIP_AI=1`이면 AI 생략)
- 업데이트 시험: `npx electron test/updater-test.js` (가짜 앱 폴더·가짜 새 버전으로 받기·풀기·바꿔 끼우기·되돌리기)
- 설치 파일: `npm run dist:mac` / `npm run dist:win` → `dist/`
  - 윈도우는 설치 없는 포터블 zip (`MeetingNotes-<버전>-windows-portable.zip`). 압축을 풀고 `MeetingNotes.exe`를 실행한다
  - 맥에서 윈도우용을 만들 때 `scripts/win-deps.js`가 윈도우 전용 이미지 모듈(sharp)을 먼저 받아 둔다
  - 맥에서 만든 exe에는 아이콘·버전 정보가 들어가지 않는다 (윈도우에서 만들면 `-c.win.signAndEditExecutable=true`로 넣을 수 있다)

## 새 버전 내기

1. `package.json`의 `version`을 올린다 (예: 0.2.0 → 0.3.0)
2. 커밋하고 태그를 올린다: `git tag v0.3.0 && git push origin main v0.3.0`
3. GitHub Actions(`.github/workflows/release.yml`)가 윈도우 zip·맥 dmg를 만들어 릴리스로 올린다
4. 사용자 앱은 6시간 안에 새 버전을 알린다. 배포 저장소는 `package.json`의 `updateRepo` (지금 `JinyoungPark/MyMeetingNotes`)

## 파일

```
src/main.js     창·기능 연결 (IPC), 설정
src/store.js    회의록 보관 (앱 데이터 폴더/meetings/<id>/)
src/stt.js      받아쓰기 (Whisper, @huggingface/transformers)
src/ai.js       AI 정리 (Claude Code / Codex 실행), 계정 로그인·로그아웃
src/updater.js  새 버전 알림·자동 업데이트 (윈도우 zip판)
src/export.js   워드·PDF(HTML)·마크다운·텍스트 만들기
ui/             화면
test/           처음부터 끝까지 써 보는 시험, 업데이트 시험
```

데이터 위치: 맥 `~/Library/Application Support/MeetingNotes/`, 윈도우 `%APPDATA%\MeetingNotes\`

## 받아쓰기 모델 (설정에서 고름)

| 모델 | 크기 | 특징 |
|---|---|---|
| base | 약 80MB | 빠르지만 한국어 정확도가 낮다 |
| small (기본) | 약 250MB | 속도와 정확도의 균형 |
| large-v3 turbo | 약 1GB | 가장 정확. 고유명사·숫자가 중요한 회의에 |
