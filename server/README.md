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
- `GET /api/pack-index` → `{builtAt, packs, questions, normVersion}` — какая база повторов сейчас на сервере
- `POST /api/pack-check` — JSON `{questions: [{text, answers: [...], media: ["crc32hex:размер", ...]}], exclude?: [id FirePacks]}`
  → `{results: [{i, kind: exact|media|answer, total, where: [{pack, tq, price}]}], packs: {id: {name, url, date, authors}},
  themes: {"id:t": [раунд, тема]}, summary: [{pack, exact, media, answer}], index}`. Лимиты: 3000 вопросов,
  60 запросов в час с IP, 2 проверки одновременно. Текст вопросов не сохраняется и не пишется в лог.
  Нет базы — 503.

## База повторов паков (`packindex/`)

Код: `packindex/update.py` (каталог FirePacks → content.xml новых паков кусками по Range → сжатый индекс
из хешей), `packlib.py` (разбор, нормализация, проверка), `check.py` (проверка пака из командной строки).
Данные: `/opt/yestudio/data/packindex/` (`index.sqlite` ~130 МБ, `data/` ~150 МБ, `logs/`, `last_run.json`).

- Установка/обновление поверх работающего сервера: `sudo ./install-packindex.sh [база.tar.gz]` — код, таймер,
  перезапуск `yestudio`. Архив с первой базой (с ПК: `index.sqlite` + `data/`) распаковывается в данные.
- Таймер `yestudio-packindex.timer` — раз в сутки около 05:00: докачать новые паки и дописать индекс.
  Работает фоном: `Nice=15`, `IOSchedulingClass=idle`, `CPUQuota=50%`, `MemoryMax=400M`. Индекс больше 1 ГБ
  или меньше 512 МБ свободного места — останавливается, старый индекс не трогает.
- Состояние: `yes-admin.sh packindex [N]` — итог последнего обновления и хвост журнала.
  Вручную: `systemctl start yestudio-packindex` (второй запуск одновременно не начнётся).
- Поменялись правила нормализации — поднять `NORM_VERSION` в `packlib.py`: индекс пересоберётся из `data/xml`.

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
