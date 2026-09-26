#!/usr/bin/env bash
# Удаление бета-сервера Ye!Studio. По умолчанию данные (/opt/yestudio/data) НЕ трогает.
# Флаг --purge — удалить и данные.
set -euo pipefail

APP_USER="yestudio"
APP_DIR="/opt/yestudio"
DATA_DIR="${APP_DIR}/data"
UNIT_NAME="yestudio.service"
PURGE=0

for arg in "$@"; do
  if [[ "${arg}" == "--purge" ]]; then
    PURGE=1
  fi
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ОШИБКА: запускать от root (sudo)." >&2
  exit 1
fi

if systemctl list-unit-files yestudio-packindex.timer >/dev/null 2>&1; then
  systemctl disable --now yestudio-packindex.timer 2>/dev/null || true
  rm -f /etc/systemd/system/yestudio-packindex.timer /etc/systemd/system/yestudio-packindex.service
  echo "таймер базы повторов удалён"
fi

if systemctl is-active --quiet "${UNIT_NAME}" 2>/dev/null; then
  systemctl stop "${UNIT_NAME}"
  echo "сервис остановлен"
fi

if systemctl is-enabled --quiet "${UNIT_NAME}" 2>/dev/null; then
  systemctl disable "${UNIT_NAME}"
  echo "автозапуск отключён"
fi

if [[ -f "/etc/systemd/system/${UNIT_NAME}" ]]; then
  rm -f "/etc/systemd/system/${UNIT_NAME}"
  systemctl daemon-reload
  echo "юнит удалён"
fi

rm -rf "${APP_DIR}/packindex"

if [[ -f "${APP_DIR}/yestudio_server.py" ]]; then
  rm -f "${APP_DIR}/yestudio_server.py"
fi

if [[ "${PURGE}" -eq 1 ]]; then
  rm -rf "${DATA_DIR}"
  echo "данные (${DATA_DIR}) удалены (--purge)"
else
  echo "данные (${DATA_DIR}) сохранены — используйте --purge для полного удаления"
fi

if id "${APP_USER}" >/dev/null 2>&1; then
  echo "пользователь ${APP_USER} оставлен (удаление вручную: userdel ${APP_USER})"
fi

echo "готово"
