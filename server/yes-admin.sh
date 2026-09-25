#!/usr/bin/env bash
# Административные команды для бета-сервера Ye!Studio.
# Запускать на сервере (данные читает/пишет от имени пользователя yestudio).
set -euo pipefail

APP_USER="yestudio"
DATA_DIR="${YES_DATA:-/opt/yestudio/data}"
INSTALLS="${DATA_DIR}/installs.json"

usage() {
  cat <<EOF
Использование: $(basename "$0") <команда> [аргументы]

Команды:
  installs                  список установок и последний визит
  errors [N]                последние N строк ошибок (по умолчанию 20)
  feedback                  список папок с отзывами
EOF
}

run_py() {
  # Выполняет python3-код от имени пользователя yestudio: файлы должен читать сервис, а не только root.
  # sudo на сервере может не быть — от root хватает runuser (util-linux, есть в любом Debian).
  if [[ "$(id -un)" == "${APP_USER}" ]]; then
    python3 -c "$1"
  elif [[ "$(id -u)" -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u "${APP_USER}" -- python3 -c "$1"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "${APP_USER}" python3 -c "$1"
  else
    echo "ОШИБКА: не могу выполнить от имени ${APP_USER} (нет runuser/sudo)." >&2
    exit 1
  fi
}

cmd="${1:-}"
shift || true

case "${cmd}" in
  installs)
    INSTALLS="${INSTALLS}" run_py '
import json, os
path = os.environ["INSTALLS"]
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    data = {}
for k, v in sorted(data.items(), key=lambda kv: kv[1].get("last", "")):
    print("%s	v=%s	last=%s	first=%s	ip=%s" % (k, v.get("v"), v.get("last"), v.get("first"), v.get("ip")))
'
    ;;
  errors)
    n="${1:-20}"
    month="$(date -u +%Y-%m)"
    file="${DATA_DIR}/errors/${month}.jsonl"
    if [[ -f "${file}" ]]; then
      tail -n "${n}" "${file}"
    else
      echo "нет файла ошибок за ${month}: ${file}"
    fi
    ;;
  feedback)
    dir="${DATA_DIR}/feedback"
    if [[ -d "${dir}" ]]; then
      ls -1 "${dir}"
    else
      echo "нет папки отзывов: ${dir}"
    fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
