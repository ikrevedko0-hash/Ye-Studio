# Ye!Studio — бета-сервер

Маленький HTTP-сервер для бета-теста десктоп-приложения «Ye!Studio»: контроль версий/блокировка установок,
приём отчётов об ошибках и обратной связи, раздача файлов обновлений (electron-updater).
Только стандартная библиотека Python 3 (3.9+), без внешних зависимостей — безопасен для машины,
где уже работают VPN и сайт.

## Установка (на Debian-сервере)

Предварительно: скопировать папку `server/` на сервер, затем от root:

```bash
cd server
sudo ./install.sh
```

Скрипт идемпотентен: проверяет python3 (>=3.9), свободность порта 8787 и наличие systemd
*до* всех изменений; создаёт пользователя `yestudio` (system, nologin), папку `/opt/yestudio` и
`/opt/yestudio/data/{errors,feedback,updates}`, копирует сервер и unit, включает и запускает сервис,
проверяет `/health`. nginx/apache, iptables/nftables,
sysctl и другие сервисы не трогает; если активен `ufw` — добавляет `ufw allow 8787/tcp`, если нет —
ничего не меняет (но предупреждает).

Удаление: `sudo ./uninstall.sh` (данные не удаляются), `sudo ./uninstall.sh --purge` (удаляет и данные).

## Как выложить обновление

Файлы кладутся в `/opt/yestudio/data/updates/`. **Порядок важен**: сначала `*.exe` и `*.blockmap`,
`latest.yml` — **последним** (electron-updater узнаёт о новой версии по latest.yml, поэтому его выкладываем,
когда остальные файлы уже на месте):

```bash
scp app.exe app.exe.blockmap yestudio@server:/opt/yestudio/data/updates/
scp latest.yml yestudio@server:/opt/yestudio/data/updates/
```

## Команды администратора (`yes-admin.sh`, на сервере)

```bash
sudo ./yes-admin.sh installs                           # список установок / последний визит
sudo ./yes-admin.sh errors [N]                         # последние N строк ошибок за текущий месяц
sudo ./yes-admin.sh feedback                           # список папок с отзывами
```

## Логи

```bash
journalctl -u yestudio -f
journalctl -u yestudio -n 100
```

## API (кратко, ключ `X-YeStudio-Key: yes-beta-2026` для /api/*)

- `GET /api/ping?id=&v=` → `{"ok": true}` — статистика запусков (`installs.json`)
- `GET /api/control?id=&v=` — то же для установок 0.2.0-beta.1, всегда `{"disabled": false}`; выключения по команде нет
- `POST /api/errors` — JSON `{id, v, os, items:[...]}` → `{"ok": true}`
- `POST /api/feedback` — JSON `{id, v, os, text, contact?, screenshot?, screenshotType?, log?}` → `{"ok": true}`
- `GET/HEAD /updates/<file>` — раздача файлов из `data/updates/`, поддержка `Range`
- `GET /health` — `ok`, без ключа

## Локальный запуск для тестов (Windows/любая ОС)

```bash
python -m unittest server.test_server -v
```

или из папки `server/`:

```bash
python -m unittest test_server -v
```

### Канал beta
Пока версия с суффиксом `-beta.N`, electron-builder пишет не `latest.yml`, а `beta.yml`.
Выкладывать его дважды — как `beta.yml` и как `latest.yml` (содержимое одинаковое), тогда клиент найдёт
обновление при любом канале. Порядок прежний: сначала exe и blockmap, yml — последними.
