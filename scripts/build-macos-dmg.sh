#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: macOS DMG can only be built on macOS."
  exit 1
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "Error: hdiutil not found. Please run in macOS environment."
  exit 1
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Error: Python not found: $PYTHON_BIN"
  exit 1
fi

if ! "$PYTHON_BIN" -m PyInstaller --version >/dev/null 2>&1; then
  echo "Error: PyInstaller is not installed. Please run first: $PYTHON_BIN -m pip install -r requirements.txt pyinstaller"
  exit 1
fi

normalize_arch() {
  case "$1" in
    x86_64|amd64|x64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "$1" ;;
  esac
}

VERSION="$(tr -d '[:space:]' < VERSION)"
if [[ -z "$VERSION" ]]; then
  echo "Error: VERSION file is empty."
  exit 1
fi

ARCH="$(normalize_arch "${OUTLOOK_EMAIL_MACOS_ARCH:-$(uname -m)}")"
DMG_NAME="${OUTLOOK_EMAIL_DMG_NAME:-OutlookEmail-macos-$ARCH-$VERSION.dmg}"
APP_PATH="$PROJECT_ROOT/dist/OutlookEmail.app"
WORK_DIR="$PROJECT_ROOT/build/macos-dmg"
STAGING_DIR="$WORK_DIR/staging"
DMG_PATH="$PROJECT_ROOT/dist/$DMG_NAME"

"$PYTHON_BIN" -m PyInstaller --noconfirm --clean outlookEmail.spec

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: $APP_PATH not generated"
  exit 1
fi

rm -rf "$STAGING_DIR"
rm -f "$DMG_PATH"
mkdir -p "$STAGING_DIR" "$PROJECT_ROOT/dist"

ditto "$APP_PATH" "$STAGING_DIR/OutlookEmail.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -volname "OutlookEmail" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "macOS installation package has been generated: $DMG_PATH"
