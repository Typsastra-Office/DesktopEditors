#!/usr/bin/env bash
# Build Typsastra Office for macOS (arm64 or x86_64) as an unsigned .app.
#
# Used by .github/workflows/release-macos.yml, can also run locally on macOS:
#   bash ci/macos/build.sh darwin_arm64 ONLYOFFICE-arm
#   bash ci/macos/build.sh darwin_x86_64 ONLYOFFICE-x86_64
#
# The release lanes (fastlane, desktop-apps/macos) sign and notarize with the
# Developer ID; this script only produces a test/shippable-unsigned artifact.
set -euo pipefail

# macOS hosted runners have limited memory; bound qmake's per-project parallelism.
export QMAKE_BUILD_JOBS="${QMAKE_BUILD_JOBS:-2}"

PLATFORM="${1:-darwin_arm64}"
SCHEME="${2:-ONLYOFFICE-arm}"

# The CI matrix names Darwin architectures; build_tools expects its own platform IDs.
case "${PLATFORM}" in
  darwin_arm64|mac_arm64)
    BUILD_TOOLS_PLATFORM="mac_arm64"
    ;;
  darwin_x86_64|mac_64)
    BUILD_TOOLS_PLATFORM="mac_64"
    ;;
  *)
    echo "unsupported macOS architecture: ${PLATFORM}" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_TOOLS="${REPO_ROOT}/build_tools"
MACOS_DIR="${REPO_ROOT}/desktop-apps/macos"
OUT_DIR="${REPO_ROOT}/desktop-apps/package/macos"
BRANDING_MAKE="${REPO_ROOT}/typsastra/build_tools/make.py"

if [ ! -d "${BUILD_TOOLS}/scripts" ]; then
  echo "build_tools submodule is not initialized. Run: git submodule update --init --recursive" >&2
  exit 1
fi

# Asset repos expected by deploy_desktop.py; kept out of the submodule list on purpose.
fetch_repo() {
  local repo="$1"
  local dir="$2"
  if [ -d "${REPO_ROOT}/${dir}" ]; then
    return
  fi
  git clone --depth 1 "https://github.com/ONLYOFFICE/${repo}.git" "${REPO_ROOT}/${dir}"
}
fetch_repo document-templates document-templates
fetch_repo core-fonts core-fonts

# Qt: install-qt-action exports QT_ROOT_DIR=<...>/Qt/<version>/macos
if [ -n "${QT_ROOT_DIR:-}" ]; then
  QT_DIR="$(dirname "${QT_ROOT_DIR}")"
elif [ -z "${QT_DIR:-}" ]; then
  echo "Qt not found: set QT_ROOT_DIR (CI) or QT_DIR" >&2
  exit 1
fi
echo "Qt dir: ${QT_DIR}"

# Configure + build the whole stack (core, sdkjs, web-apps, desktop-sdk, desktop-apps)
# for the requested architecture. --branding typsastra also sets the release number.
cd "${BUILD_TOOLS}"
python3 ./configure.py \
  --branch master \
  --platform "${BUILD_TOOLS_PLATFORM}" \
  --module desktop \
  --qt-dir "${QT_DIR}" \
  --branding typsastra \
  --branding-name typsastra \
  --update 0
python3 ./make.py

# Version comes from the branding repo (upstream base + Typsastra release).
BRAND_BASE_VERSION="$(sed -n 's/^BRAND_BASE_VERSION *= *"\(.*\)"/\1/p' "${BRANDING_MAKE}")"
BRAND_RELEASE="$(sed -n 's/^BRAND_RELEASE *= *"\(.*\)"/\1/p' "${BRANDING_MAKE}")"
APP_VERSION="${BRAND_BASE_VERSION}.${BRAND_RELEASE}"
echo "app version: ${APP_VERSION}"

# The Info.plist values in the repository are stale, set them from the branding.
PLIST="${MACOS_DIR}/ONLYOFFICE/Resources/${SCHEME}/Info.plist"
if [ ! -f "${PLIST}" ]; then
  echo "missing ${PLIST}" >&2
  exit 1
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BRAND_RELEASE}" "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :ASCBundleBuildNumber ${BRAND_RELEASE}" "${PLIST}"
/usr/libexec/PlistBuddy -c "Set :ASCWebappsHelpUrl https://github.com/Typsastra-Office" "${PLIST}" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Add :ASCWebappsHelpUrl string https://github.com/Typsastra-Office" "${PLIST}"

# License file next to the resources copied by the Xcode build phases.
mkdir -p "${MACOS_DIR}/Vendor/ONLYOFFICE/license"
cp -fv "${REPO_ROOT}/desktop-apps/package/common/license/opensource/LICENSE.html" \
       "${MACOS_DIR}/Vendor/ONLYOFFICE/license/LICENSE.html"

# Build the app bundle (unsigned).
cd "${MACOS_DIR}"
CODE_SIGN_WRAPPER_DIR="$(mktemp -d)"
trap 'rm -rf "${CODE_SIGN_WRAPPER_DIR}"' EXIT
cat > "${CODE_SIGN_WRAPPER_DIR}/codesign" <<'EOF'
#!/bin/sh
if [ "${OO_SKIP_CODESIGN:-0}" = "1" ]; then
  echo "Skipping explicit code signing for unsigned CI build"
  exit 0
fi
exec /usr/bin/codesign "$@"
EOF
chmod +x "${CODE_SIGN_WRAPPER_DIR}/codesign"
export OO_SKIP_CODESIGN=1
export PATH="${CODE_SIGN_WRAPPER_DIR}:${PATH}"
xcodebuild -project ONLYOFFICE.xcodeproj \
  -scheme "${SCHEME}" \
  -configuration Release \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

APP_PATH="build/Build/Products/Release/ONLYOFFICE.app"
if [ ! -d "${APP_PATH}" ]; then
  echo "app bundle was not produced: ${APP_PATH}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
ZIP="${OUT_DIR}/TypsastraOffice-${SCHEME}-${APP_VERSION}.zip"
rm -f "${ZIP}"
ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ZIP}"

echo "artifact:"
ls -lh "${ZIP}"
