@set "YE_DIR=%~dp0" & set "YE_SELF=%~nx0" & powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; iex ($s.Substring($s.IndexOf('#'+'PS#') + 4))"
@exit /b
#PS#
# Обновить Ye-Studio на этом компьютере с GitHub — двойным щелчком, без агента и без GitHub Desktop.
#  1. Несохранённые правки (и коммиты, которых нет на GitHub) — в отдельную ветку local-after-release-<дата>,
#     она же выкладывается на GitHub: ничего не теряется, Claude потом сольёт её с основной версией.
#  2. Ветка main — ровно как на GitHub.
#  3. npm install в app.
# Запускать можно сколько угодно раз: без правок он просто скачивает свежую версию.

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Host.UI.RawUI.WindowTitle = 'Ye-Studio: обновление с GitHub'
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Finish($code) { Write-Host ''; if (-not $env:YE_NO_PAUSE) { Read-Host 'Нажмите Enter, чтобы закрыть' | Out-Null }; exit $code }

try {
  # ---------- git: свой или из GitHub Desktop ----------
  $git = (Get-Command git -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $git) {
    $git = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $git) { Say 'Не нашёл git. Поставьте GitHub Desktop (desktop.github.com) и запустите снова.' Red; Finish 1 }
  function G { & $git @args; if ($LASTEXITCODE) { throw "git $($args -join ' ') — ошибка $LASTEXITCODE" } }
  function Gq { $o = & $git @args 2>$null; if ($LASTEXITCODE) { return $null }; return $o }

  # ---------- папка проекта ----------
  $cands = @($env:YE_DIR, "$env:USERPROFILE\Documents\GitHub\Ye-Studio", "$env:USERPROFILE\Documents\Ye-Studio",
    "$env:USERPROFILE\Desktop\Ye-Studio", "$env:USERPROFILE\source\repos\Ye-Studio", "$env:USERPROFILE\Ye-Studio")
  $repo = $cands | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ '.git')) } | Select-Object -First 1
  while (-not $repo) {
    Say 'Не нашёл папку Ye-Studio сама. Проще всего — положить этот файл в папку Ye-Studio и запустить оттуда.' Yellow
    $p = (Read-Host 'Или вставьте сюда путь к папке Ye-Studio (там, где папка app)').Trim('"', ' ')
    if (-not $p) { Finish 1 }
    if (Test-Path -LiteralPath (Join-Path $p '.git')) { $repo = $p } else { Say "В «$p» нет проекта (.git)." Red }
  }
  Set-Location -LiteralPath $repo
  $origin = Gq remote get-url origin
  if ($origin -notmatch 'Ye-Studio') { Say "Папка $repo — не Ye-Studio (origin: $origin)." Red; Finish 1 }
  Say "Папка проекта: $repo" Cyan

  Say 'Скачиваю, что нового на GitHub…'
  G fetch origin --prune

  # ---------- 1. свои правки — в отдельную ветку ----------
  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  $saved = @()
  # сам этот файл, скачанный в папку проекта, — не правка автора
  $self = if ($env:YE_DIR -and ((Resolve-Path -LiteralPath $env:YE_DIR).Path.TrimEnd('\') -eq (Resolve-Path -LiteralPath $repo).Path.TrimEnd('\'))) { $env:YE_SELF } else { $null }
  $ex = if ($self) { @('--', '.', ":(exclude)$self") } else { @() }
  $changes = @(Gq status --porcelain @ex | Where-Object { $_ })
  if ($changes.Count -gt 0) {
    $br = "local-after-release-$stamp"
    Say "Есть несохранённые правки: файлов $($changes.Count). Сохраняю их в ветку $br" Yellow
    $changes | Select-Object -First 30 | ForEach-Object { Say "   $_" DarkGray }
    G checkout -q -b $br
    G add -A @ex
    $id = @()
    if (-not (Gq config user.name)) { $id += @('-c', 'user.name=Ye-Studio author') }
    if (-not (Gq config user.email)) { $id += @('-c', 'user.email=author@localhost') }
    & $git @id commit -q -m "Локальные правки после релиза ($stamp)"
    if ($LASTEXITCODE) { throw 'не удалось сохранить правки (git commit)' }
    $saved += $br
  }
  # коммиты, которых нет на GitHub, — тоже в ветку (текущая и main)
  $cur = Gq rev-parse --abbrev-ref HEAD
  if (-not $saved -and $cur -and $cur -ne 'HEAD' -and $cur -ne 'main' -and (Gq rev-list --count "origin/main..HEAD") -gt 0 -and
      -not (Gq rev-parse --verify -q "origin/$cur")) { $saved += $cur }
  if ((Gq rev-parse --verify -q main) -and [int](Gq rev-list --count "origin/main..main") -gt 0) {
    $mb = "local-main-$stamp"
    Say "В локальной main есть коммиты, которых нет на GitHub — сохраняю их в ветку $mb" Yellow
    G branch $mb main
    $saved += $mb
  }
  $pushed = @(); $notPushed = @()
  foreach ($b in $saved) {
    Say "Выкладываю ветку $b на GitHub (может открыться окно входа в GitHub)…"
    & $git push -u origin $b
    if ($LASTEXITCODE) { $notPushed += $b } else { $pushed += $b }
  }

  # ---------- 2. main — как на GitHub ----------
  Say 'Переключаюсь на свежую версию (ветка main)…'
  # скачанная копия этого файла мешала бы git положить его же из main — она уже прочитана, её можно убрать
  if ($self -and -not (Gq ls-files -- $self)) {
    & $git cat-file -e "origin/main:$self" 2>$null
    if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath (Join-Path $repo $self) -Force }
  }
  G checkout -q -B main origin/main
  G branch -q --set-upstream-to=origin/main main
  Say ('Версия: ' + (Gq log -1 --format='%h %s')) Cyan

  # ---------- 3. зависимости ----------
  if (Test-Path -LiteralPath (Join-Path $repo 'app\package.json')) {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
      Say 'Ставлю зависимости (npm install в app) — пару минут…'
      Push-Location -LiteralPath (Join-Path $repo 'app')
      & npm install --no-audit --no-fund
      $npmCode = $LASTEXITCODE
      Pop-Location
      if ($npmCode) { Say 'npm install завершился с ошибкой — код скачан, но зависимости поставьте ещё раз: запустите этот файл снова.' Yellow }
    } else {
      Say 'Не нашёл Node.js (npm) — код скачан, а зависимости поставьте, когда он будет: npm install в папке app.' Yellow
    }
  }

  Write-Host ''
  Say 'Готово: в папке — последняя версия Ye-Studio с GitHub.' Green
  if ($pushed) { Say ("Ваши правки сохранены на GitHub в ветке: " + ($pushed -join ', ') + ' — напишите Claude, он сольёт их с основной версией.') Green }
  if ($notPushed) {
    Say ("Ветка с вашими правками сохранена на компьютере, но не выложилась: " + ($notPushed -join ', ')) Yellow
    Say 'Откройте GitHub Desktop, выберите эту ветку (Current branch) и нажмите Publish branch.' Yellow
  }
  Finish 0
} catch {
  Say "Не получилось: $($_.Exception.Message)" Red
  Say 'Ничего не удалено: правки, если были, лежат в ветке local-after-release-… Пришлите этот текст Claude.' Yellow
  Finish 1
}
