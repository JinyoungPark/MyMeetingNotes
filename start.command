#!/bin/zsh
# Finder에서 두 번 누르면 회의록 앱을 실행한다 (개발용. 설치 파일은 npm run dist:mac 으로 만든다)
cd "$(dirname "$0")"
exec ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . >/dev/null 2>&1 &
