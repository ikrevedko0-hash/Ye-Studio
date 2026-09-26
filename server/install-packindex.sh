#!/usr/bin/env bash
# Установить/обновить базу повторов паков на сервере Ye!Studio (поверх уже работающего yestudio).
# Идемпотентно. Копирует код (packindex/, yestudio_server.py), ставит таймер, перезапускает сервис.
# Не трогает файрвол, nginx, VPN и другие сервисы. Запускать от root из папки server/.
#   ./install-packindex.sh            — код и таймер
#   ./install-packindex.sh <архив>    — плюс развернуть первую базу (tar.gz с ПК: data/ и index.sqlite)
set -euo pipefail

APP_USER="yestudio"
APP_DIR="/opt/yestudio"
PI_DATA="${APP_DIR}/data/packindex"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(id -u)" -eq 0 ]] || { echo "ОШИБКА: запускать от root." >&2; exit 1; }
systemctl is-active --quiet yestudio || { echo "ОШИБКА: сервис yestudio не запущен — сначала install.sh." >&2; exit 1; }
python3 -c 'import sqlite3; c=sqlite3.connect(":memory:"); c.execute("create table t(a integer primary key) without rowid")' \
  || { echo "ОШИБКА: sqlite3 в python3 слишком старый." >&2; exit 1; }

echo "== Код =="
mkdir -p "${APP_DIR}/packindex" "${PI_DATA}"
cp -f "${SCRIPT_DIR}"/packindex/*.py "${APP_DIR}/packindex/"
cp -f "${SCRIPT_DIR}/yestudio_server.py" "${APP_DIR}/yestudio_server.py"
install -m 755 "${SCRIPT_DIR}/yes-admin.sh" /usr/local/bin/yes-admin

if [[ -n "${1:-}" ]]; then
  echo "== Первая база из ${1} =="
  free_mb=$(df -Pm "${PI_DATA}" | awk 'NR==2{print $4}')
  need_mb=$(( $(stat -c %s "$1") * 6 / 1048576 + 512 ))
  [[ "${free_mb}" -ge "${need_mb}" ]] || { echo "ОШИБКА: мало места: ${free_mb} МБ, нужно ${need_mb}." >&2; exit 1; }
  tar -xzf "$1" -C "${PI_DATA}"
  python3 -c "import sqlite3,sys; c=sqlite3.connect('file:${PI_DATA}/index.sqlite?mode=ro',uri=True); print('в базе:', dict(c.execute('select key,value from meta')))"
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/packindex" "${APP_DIR}/yestudio_server.py" "${PI_DATA}"

echo "== Таймер =="
cp -f "${SCRIPT_DIR}/yestudio-packindex.service" /etc/systemd/system/
cp -f "${SCRIPT_DIR}/yestudio-packindex.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now yestudio-packindex.timer
systemctl restart yestudio
sleep 1
python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=5).read().strip()==b'ok' else 1)" \
  && echo "health OK" || { echo "ОШИБКА: /health не отвечает. journalctl -u yestudio -n 50" >&2; exit 1; }
systemctl list-timers yestudio-packindex.timer --no-pager | head -3
echo "Готово. Состояние базы: yes-admin.sh packindex"
