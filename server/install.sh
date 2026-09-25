#!/usr/bin/env bash
# Идемпотентная установка бета-сервера Ye!Studio на Debian.
# Запускать от root (sudo). Не трогает VPN, сайт, nginx/apache, iptables/nftables, sysctl.
set -euo pipefail

APP_USER="yestudio"
APP_DIR="/opt/yestudio"
DATA_DIR="${APP_DIR}/data"
PORT="8787"
UNIT_NAME="yestudio.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== Ye!Studio: проверки перед установкой =="

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ОШИБКА: запускать от root (sudo)." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ОШИБКА: python3 не найден." >&2
  exit 1
fi

PY_VER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
PY_OK="$(python3 -c 'import sys; print(1 if sys.version_info >= (3,9) else 0)')"
if [[ "${PY_OK}" != "1" ]]; then
  echo "ОШИБКА: нужен python3 >= 3.9, найден ${PY_VER}." >&2
  exit 1
fi
echo "python3 ${PY_VER} — ок"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ОШИБКА: systemd (systemctl) не найден." >&2
  exit 1
fi
echo "systemd — ок"

if command -v ss >/dev/null 2>&1; then
  if ss -ltn "( sport = :${PORT} )" | grep -q ":${PORT}"; then
    echo "ОШИБКА: порт ${PORT} уже занят:" >&2
    ss -ltnp "( sport = :${PORT} )" >&2 || true
    exit 1
  fi
  echo "порт ${PORT} свободен — ок"
else
  echo "ПРЕДУПРЕЖДЕНИЕ: 'ss' не найден, проверку занятости порта ${PORT} пропускаю." >&2
fi

echo "== Установка =="

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "${APP_USER}"
  echo "создан системный пользователь ${APP_USER}"
else
  echo "пользователь ${APP_USER} уже существует"
fi

mkdir -p "${DATA_DIR}/errors" "${DATA_DIR}/feedback" "${DATA_DIR}/updates"
mkdir -p "${APP_DIR}"

cp -f "${SCRIPT_DIR}/yestudio_server.py" "${APP_DIR}/yestudio_server.py"

if [[ ! -f "${DATA_DIR}/control.json" ]]; then
  cat > "${DATA_DIR}/control.json" <<'JSON'
{
  "global": { "disabled": false, "message": null },
  "blocked": {}
}
JSON
  echo "создан ${DATA_DIR}/control.json"
else
  echo "${DATA_DIR}/control.json уже существует — не трогаю"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

cp -f "${SCRIPT_DIR}/yestudio.service" "/etc/systemd/system/${UNIT_NAME}"

systemctl daemon-reload
systemctl enable --now "${UNIT_NAME}"

echo "== Проверка сервиса =="
sleep 1
# curl на минимальном Debian может не быть — проверяем тем же python3
if python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${PORT}/health', timeout=5).read().strip()==b'ok' else 1)"; then
  echo "health OK: сервис отвечает на 127.0.0.1:${PORT}"
else
  echo "ОШИБКА: /health не отвечает. Смотри: journalctl -u ${UNIT_NAME} -n 50" >&2
  exit 1
fi

echo "== Файрвол =="
if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS="$(ufw status | head -n1 || true)"
  # «Status: inactive» тоже содержит слово active — сверяем строку целиком
  if echo "${UFW_STATUS}" | grep -qx "Status: active"; then
    ufw allow ${PORT}/tcp
    echo "ufw активен: добавлено правило 'ufw allow ${PORT}/tcp'"
  else
    echo "ufw установлен, но неактивен — не включаю, ничего не меняю."
  fi
elif command -v nft >/dev/null 2>&1 || command -v iptables >/dev/null 2>&1; then
  echo "ПРЕДУПРЕЖДЕНИЕ: обнаружен nftables/iptables — порт ${PORT} может быть закрыт файрволом, проверить вручную."
else
  echo "файрвол не обнаружен, ничего не меняю."
fi

echo "== Готово =="
echo "Сервис ${UNIT_NAME} запущен и включён в автозапуск."
echo "Данные: ${DATA_DIR}"
echo "Логи: journalctl -u ${UNIT_NAME} -f"
