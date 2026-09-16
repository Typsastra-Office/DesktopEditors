#!/usr/bin/env bash
# Build ONLYOFFICE-based DesktopEditors for linux_64.
# Used by .github/workflows/release-linux.yml, can also run locally:
#   bash ci/linux/build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_TOOLS="${REPO_ROOT}/build_tools"

if [ ! -d "${BUILD_TOOLS}/scripts" ]; then
  echo "build_tools submodule is not initialized. Run: git submodule update --init build_tools" >&2
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

# System dependencies (same set as build_tools/tools/linux/deps.py).
sudo apt-get update
sudo apt-get install -y python3 python3-pip python-is-python3

cd "${BUILD_TOOLS}/tools/linux"
python3 ./deps.py
python3 ./qt_binary_fetch.py amd64
if [ ! -d ./sysroot/ubuntu16-amd64-sysroot ]; then
  (cd ./sysroot && python3 ./fetch.py amd64)
fi

# Configure and build. update=0 - use the checkouts provided by the workflow,
# do not fetch/checkout repositories from the network.
cd "${BUILD_TOOLS}"
python3 ./configure.py \
  --branch master \
  --platform linux_64 \
  --module desktop \
  --sysroot 1 \
  --qt-dir "${BUILD_TOOLS}/tools/linux/qt_build/Qt-5.9.9" \
  --update 0
python3 ./make.py
