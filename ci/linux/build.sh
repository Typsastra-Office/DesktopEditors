#!/usr/bin/env bash
# Build ONLYOFFICE-based DesktopEditors for linux_64.
# Used by .github/workflows/release-linux.yml, can also run locally:
#   bash ci/linux/build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_TOOLS="${REPO_ROOT}/build_tools"
LINUX_TOOLS="${BUILD_TOOLS}/tools/linux"

# Kept in sync with BRANDING/PLATFORM passed to configure.py below.
BRANDING="typsastra"
PLATFORM="linux_64"
APP_DIR="${BUILD_TOOLS}/out/${PLATFORM}/${BRANDING}/desktopeditors"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

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

log "System packages"
# SKIP_APT=1 lets the script be re-run on a machine where the packages are
# already installed and sudo is not available. The CI runner has passwordless
# sudo and never sets it.
if [ "${SKIP_APT:-0}" != "1" ]; then
  sudo apt-get update
  # libsm6/libice6 are needed at build time; the *bundled* copies shipped with the
  # application come from the sysroot, so the package versions do not set the
  # artifact's glibc requirement.
  sudo apt-get install -y python3 python3-pip python-is-python3 patchelf libsm6 libice6
else
  echo "SKIP_APT=1, assuming system packages are already present."
fi

log "Build dependencies, Qt and sysroot"
(cd "${LINUX_TOOLS}" && python3 ./deps.py)
(cd "${LINUX_TOOLS}" && python3 ./qt_binary_fetch.py amd64)
if [ ! -d "${LINUX_TOOLS}/sysroot/ubuntu16-amd64-sysroot" ] || [ ! -d "${LINUX_TOOLS}/sysroot/ubuntu16-arm64-sysroot" ]; then
  (cd "${LINUX_TOOLS}/sysroot" && python3 ./fetch.py all)
fi

# libheif 1.18.2 declares a cmake_minimum_required that CMake 4 rejects, and the
# runner's ~/.local/bin/cmake may be 4.x. Pin a 3.x toolchain and put it first on
# PATH so the build cannot pick up a too-new cmake. This mirrors
# build_tools/build-onlyoffice-x64.sh.
log "Pin CMake"
CMAKE_VERSION="3.30.0"
CMAKE_DIR="cmake-${CMAKE_VERSION}-linux-x86_64"
CMAKE_HOME="${LINUX_TOOLS}/${CMAKE_DIR}"
if [ ! -x "${CMAKE_HOME}/bin/cmake" ]; then
  # Remove a partial extraction from an interrupted earlier run, otherwise
  # tar can fail or leave a tree without bin/cmake.
  rm -rf "${CMAKE_HOME}"
  (cd "${LINUX_TOOLS}" \
    && wget -q "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/${CMAKE_DIR}.tar.gz" \
    && tar -xzf "${CMAKE_DIR}.tar.gz" \
    && rm -f "${CMAKE_DIR}.tar.gz")
fi
[ -x "${CMAKE_HOME}/bin/cmake" ] || die "CMake ${CMAKE_VERSION} was not unpacked into ${CMAKE_HOME}."
export PATH="${CMAKE_HOME}/bin:${PATH}"
# Confirm the pin is the cmake the build will actually use.
cmake --version | head -1
case "$(command -v cmake)" in
  "${CMAKE_HOME}"/*) ;;
  *) die "cmake resolved to $(command -v cmake), expected the pinned ${CMAKE_HOME}/bin/cmake." ;;
esac

# update=0 - use the checkouts provided by the workflow, do not fetch/checkout
# repositories from the network.
log "Configure and build"
cd "${BUILD_TOOLS}"
python3 ./configure.py \
  --branch master \
  --platform "${PLATFORM}" \
  --module desktop \
  --sysroot 1 \
  --qt-dir "${LINUX_TOOLS}/qt_build/Qt-5.9.9" \
  --branding "${BRANDING}" \
  --branding-name "${BRANDING}" \
  --update 0
python3 ./make.py

# ---------------------------------------------------------------------------
# Verification. The previous check ran ldd on platforms/libqxcb.so, which cannot
# detect the X11 session libraries it claimed to be checking: libqxcb has no
# libSM/libICE DT_NEEDED entries, they are pulled in later through
# libQt5XcbQpa at plugin load time. Check the libraries that are actually
# linked instead, and gate the release on the resulting ABI floor.
# ---------------------------------------------------------------------------
log "Verify the bundle"
APP_BIN="${APP_DIR}/DesktopEditors"
[ -x "${APP_BIN}" ] || die "Build completed without producing ${APP_BIN}."

# libSM/libICE must be present: libqxcb cannot load without them.
for lib in libSM.so.6 libICE.so.6; do
  [ -e "${APP_DIR}/${lib}" ] || die "${lib} is missing from the bundle; the xcb backend will fail to load."
done

# Every library on the paths that are actually loaded at run time must resolve.
# This deliberately does not sweep every bundled *.so: the Wayland platform
# plugins and the virtual keyboard plugin depend on Qt5WaylandClient/Qt5Quick/
# Qt5Qml, which are deliberately not shipped for an xcb target, so they can
# never resolve and a blanket sweep would fail regardless of build quality.
# Checked instead are the application binary, the xcb chain it loads
# libQt5XcbQpa for, and the converter that runs as a separate process.
# Each library is checked with its own directory on LD_LIBRARY_PATH, because the
# converter resolves its siblings next to itself rather than in the app root.
check_resolves() {
  local lib="$1"
  local dir
  dir="$(dirname "${lib}")"
  local missing
  missing="$(LD_LIBRARY_PATH="${dir}:${APP_DIR}" ldd "${lib}" 2>/dev/null | grep "not found" || true)"
  if [ -n "${missing}" ]; then
    echo "Unresolved runtime dependencies in ${lib#"${APP_DIR}"/}:" >&2
    echo "${missing}" >&2
    return 1
  fi
  return 0
}

rc=0
for lib in \
  "${APP_BIN}" \
  "${APP_DIR}/libQt5XcbQpa.so.5" \
  "${APP_DIR}/platforms/libqxcb.so" \
  "${APP_DIR}/converter/x2t" \
  "${APP_DIR}/converter/libdoctrenderer.so"
do
  if [ ! -e "${lib}" ]; then
    echo "Missing from the bundle: ${lib#"${APP_DIR}"/}" >&2
    rc=1
    continue
  fi
  check_resolves "${lib}" || rc=1
done
[ "${rc}" -eq 0 ] || die "The bundle has unresolved runtime dependencies."

# The package must stay runnable on the oldest supported Ubuntu. The floor is
# set by CEF and the sysroot-built core, not by the machine that built it, so
# this catches a future change that re-introduces a host dependency.
#
# The offending libraries are named when the floor is breached. Reporting only
# the version gives no way to tell which step leaked the host's glibc
# requirement: the usual cause is a library copied out of the build host instead
# of being taken from the sysroot, which raises the floor on newer runner images
# while still building cleanly on an older one.
MAX_GLIBC="${MAX_GLIBC:-2.17}"
glibc_per_lib="$(
  find -L "${APP_DIR}" -name '*.so*' -type f | sort | while IFS= read -r lib; do
    highest="$(objdump -T "${lib}" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' \
      | cut -d_ -f2 | sort -V -u | tail -1)"
    [ -n "${highest}" ] && printf '%s\t%s\n' "${highest}" "${lib#"${APP_DIR}"/}"
  done
)"
actual_vers="$(printf '%s\n' "${glibc_per_lib}" | awk 'NF' | cut -f1 | sort -V -u | tail -1)"
echo "Highest required GLIBC symbol: ${actual_vers:-none} (limit ${MAX_GLIBC})"
if [ -n "${actual_vers}" ] && [ "$(printf '%s\n%s\n' "${MAX_GLIBC}" "${actual_vers}" | sort -V | tail -1)" != "${MAX_GLIBC}" ]; then
  {
    echo "Bundled libraries needing a newer GLIBC than ${MAX_GLIBC}:"
    printf '%s\n' "${glibc_per_lib}" | awk -F'\t' -v max="${actual_vers}" \
      'NF && $1 == max { print "  " $2 " (GLIBC_" $1 ")" }'
    echo
    echo "A library that is out of line with the rest of the bundle was probably"
    echo "copied from the build host rather than taken from the sysroot."
  } >&2
  die "The bundle needs GLIBC ${actual_vers}, above the supported ${MAX_GLIBC}. This makes the package non-portable."
fi

# Smoke-test the binary the same way it is shipped.
echo "Start-up check:"
(cd "${APP_DIR}" && QT_QPA_PLATFORM=offscreen LD_LIBRARY_PATH=./ timeout 120 ./DesktopEditors --version 2>&1) | sed 's/^/  /'
