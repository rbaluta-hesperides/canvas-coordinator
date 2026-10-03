#!/bin/bash
set -u

# Finder does not inherit every Terminal profile; include both Homebrew locations.
export PATH="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}:/opt/homebrew/bin:/usr/local/bin"

fail() {
  printf '\n%s\n' "$1" >&2
  if [ -t 0 ]; then
    read -r -p "Pulsa Intro para cerrar... " coordinator_reply
  fi
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "Este archivo abre Campus Coordinator en macOS. En Windows usa ABRIR.bat."
coordinator_macos_version="$(sw_vers -productVersion)"
[ "${coordinator_macos_version%%.*}" -ge 13 ] || fail "Necesitas macOS 13 Ventura o posterior para abrir esta versión."

cd -- "$(dirname "$0")" || fail "No se pudo abrir la carpeta de Campus Coordinator."
command -v node >/dev/null 2>&1 || fail "Instala Node.js 22.12 o posterior desde https://nodejs.org y vuelve a abrir ABRIR.command."
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1);' || fail "Necesitas Node.js 22.12 o posterior. Actualízalo desde https://nodejs.org y vuelve a abrir ABRIR.command."
command -v npm >/dev/null 2>&1 || fail "No se encontró npm. Instala Node.js con npm o ejecuta npm start desde tu Terminal habitual."

if [ ! -x "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
  printf '%s\n' "Instalando las dependencias de Campus Coordinator..."
  npm ci || fail "No se pudieron instalar las dependencias. Revisa la conexión y el error anterior; después vuelve a abrir ABRIR.command."
fi

npm start || fail "No se pudo abrir Campus Coordinator. Revisa el error anterior."
