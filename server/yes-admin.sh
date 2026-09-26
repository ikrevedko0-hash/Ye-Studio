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
  packindex [N]             база повторов: итог последнего обновления и N строк его журнала
  reviews [summary [пак]]   отзывы игроков: сводка по пакам
  reviews export <пак>      выгрузка отзывов на пак (JSON)
  reviews hide <пак> <ник>  убрать ник с доски дайверов
  reviews token             ключ выгрузки для «скачать отзывы игроков.py»
  reviews auto [N]          автопубликация новых Уе!паков: что выложено и N строк журнала
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
  packindex)
    n="${1:-30}"
    pi="${DATA_DIR}/packindex"
    if [[ -f "${pi}/last_run.json" ]]; then
      cat "${pi}/last_run.json"; echo
      log="$(ls -1t "${pi}"/logs/update-*.log 2>/dev/null | head -n1 || true)"
      [[ -n "${log}" ]] && { echo "--- ${log}"; tail -n "${n}" "${log}"; }
    else
      echo "база ещё не обновлялась: нет ${pi}/last_run.json"
    fi
    ls -la "${pi}/index.sqlite" 2>/dev/null || true
    systemctl list-timers yestudio-packindex.timer --no-pager 2>/dev/null | head -3 || true
    ;;
  reviews)
    [[ $# -eq 0 ]] && set -- summary
    if [[ "$1" == "auto" ]]; then
      cat "${DATA_DIR}/reviews/autopublish.json" 2>/dev/null || echo "автопубликация ещё ничего не выкладывала"
      echo; journalctl -u yestudio-reviews --no-pager -n "${2:-20}" 2>/dev/null || true
      systemctl list-timers yestudio-reviews.timer --no-pager 2>/dev/null | head -3 || true
      exit 0
    fi
    if [[ "$(id -un)" == "${APP_USER}" ]]; then
      YES_DATA="${DATA_DIR}" python3 /opt/yestudio/reviews/reviews.py "$@"
    else
      runuser -u "${APP_USER}" -- env YES_DATA="${DATA_DIR}" python3 /opt/yestudio/reviews/reviews.py "$@"
    fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
