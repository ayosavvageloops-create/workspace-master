#!/bin/bash
# Собирает Uniqualizer.app и Uniqualizer.dmg. Запускать НА MAC:
#   bash macos/build_dmg.sh
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Uniqualizer.app"
DMG="Uniqualizer.dmg"

rm -rf build "$DMG"
mkdir -p build/dmg

# 1. AppleScript-приложение (принимает drag&drop видео)
osacompile -o "$APP" Uniqualizer.applescript
cp ../uniq.py "$APP/Contents/Resources/uniq.py"

# 2. DMG: приложение + ярлык на Applications
cp -R "$APP" build/dmg/
ln -s /Applications build/dmg/Applications
hdiutil create -volname "Uniqualizer" -srcfolder build/dmg -ov -format UDZO "$DMG"

echo "Готово: $(pwd)/$DMG"
echo "Нужны: ffmpeg (brew install ffmpeg) и Xcode Command Line Tools (xcode-select --install)."
