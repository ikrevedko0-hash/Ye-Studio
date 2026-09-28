// Стенд «Прогон в SIGame». Проверяет пак настоящим кодом SIGame, а не нашей моделью:
//
// 1. Открытие. SIDocument.Load — тот же вызов, которым SIGame и SIQuester открывают пак. Что он прочитал,
//    сверяем с content.xml, разобранным независимо (XDocument): так ловится, например, пустой <info />,
//    после которого SIPackages (InfoSerializer.ReadXml не смотрит IsEmptyElement) теряет соседние темы.
// 2. Ссылки на файлы: есть ли файл в пакете с точки зрения SIPackages.
// 3. Игра. Настоящая игра SICore (GameRunner.CreateGame) — как в SIGame при «Новая игра»:
//    пак распаковывается SIDocument.ExtractToFolderAndLoadAsync, файлы раздаются по HTTP так же, как WebManager.
//    Ведущий и двое игроков — наши клиенты: выбирают вопросы по порядку, отвечают, ставят минимум, а ведущий
//    торопит игру кнопкой «Дальше» (MOVE 1), как живой ведущий. Каждый раунд — отдельная игра (MOVE 3 — переход
//    к раунду, есть и в SIGame), игры идут параллельно. Всё, что видит зритель, пишется как есть.
// 4. Медиа. Каждый адрес картинки/звука/видео, который движок разослал игрокам, запрашивается у раздачи.
//
// Вывод — JSON по строке на событие (stdout). После игры раздача файлов остаётся жить, пока не закрыт stdin:
// Ye!Studio в это время показывает записанные сообщения настоящим столом SIOnline.
//
// sigame-runner <pack.siq> [--parallel N] [--rounds 0,1] [--round-timeout 900] [--stall 120] [--no-play] [--exit]

using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;
using SICore;
using SICore.Clients;
using SICore.Contracts;
using SICore.Models;
using SICore.Network;
using SICore.Network.Clients;
using SICore.Network.Configuration;
using SICore.Network.Contracts;
using SICore.Network.Servers;
using SIData;
using SIPackages;
using SIPackages.Core;

Console.OutputEncoding = new UTF8Encoding(false);
var json = new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
var outLock = new object();
void Emit(object o) { var s = JsonSerializer.Serialize(o, json); lock (outLock) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

if (args.Length == 0)
{
    Console.Error.WriteLine("sigame-runner <pack.siq> [--parallel N] [--rounds 0,1] [--round-timeout 900] [--stall 120] [--no-play] [--exit]");
    return 64;
}

var packPath = Path.GetFullPath(args[0]);
string? Opt(string name) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
var parallel = int.TryParse(Opt("--parallel"), out var par) ? Math.Max(1, par) : Math.Max(1, Math.Min(4, Environment.ProcessorCount / 2));
var roundTimeout = TimeSpan.FromSeconds(int.TryParse(Opt("--round-timeout"), out var rt) ? rt : 900);
// столько игра может не начинать и не заканчивать ни одного вопроса — дальше раунд считаем застрявшим
var stall = TimeSpan.FromSeconds(int.TryParse(Opt("--stall"), out var st) ? st : 120);
var onlyRounds = Opt("--rounds")?.Split(',').Select(int.Parse).ToHashSet();
var noPlay = args.Contains("--no-play");
var exitAfter = args.Contains("--exit");

Emit(new { type = "start", pack = packPath, engine = typeof(GameRunner).Assembly.GetName().Version?.ToString(), packages = typeof(SIDocument).Assembly.GetName().Version?.ToString() });

// ---------- 1. открытие ----------

var file = ReadRaw(packPath);
SIDocument doc;
try
{
    using var stream = File.OpenRead(packPath);
    doc = SIDocument.Load(stream);
}
catch (Exception e)
{
    Emit(new { type = "open", ok = false, error = $"{e.GetType().Name}: {e.Message}", file = file.Summary() });
    return 2;
}

var seen = Structure.From(doc.Package);
var lost = file.Compare(seen);
Emit(new { type = "open", ok = lost.Count == 0, file = file.Summary(), sigame = seen.Summary(), lost });

// ---------- 2. ссылки на файлы ----------

var missing = new List<object>();
for (var ri = 0; ri < doc.Package.Rounds.Count; ri++)
    for (var ti = 0; ti < doc.Package.Rounds[ri].Themes.Count; ti++)
        for (var qi = 0; qi < doc.Package.Rounds[ri].Themes[ti].Questions.Count; qi++)
            foreach (var item in Items(doc.Package.Rounds[ri].Themes[ti].Questions[qi]))
            {
                if (!item.IsRef) continue;
                var collection = doc.TryGetCollection(item.Type);
                if (collection == null || !collection.Contains(item.Value))
                    missing.Add(new { round = ri, theme = ti, question = qi, kind = item.Type, name = item.Value });
            }
Emit(new { type = "refs", missing });
doc.Dispose();

// SIGame потеряла часть пака — играть в огрызок незачем, ошибка уже названа
if (noPlay || lost.Count > 0)
{
    Emit(new { type = "done", played = 0, expected = seen.Questions, seconds = 0 });
    return 0;
}

// ---------- 3. игра ----------

var work = Path.Combine(Path.GetTempPath(), "ye-sigame-run", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(work);
var sw = Stopwatch.StartNew();
var rounds = Enumerable.Range(0, seen.Rounds.Count).Where(i => onlyRounds == null || onlyRounds.Contains(i)).ToArray();
var servers = new ConcurrentBag<MediaServer>();
var results = new ConcurrentBag<int>();

await Parallel.ForEachAsync(rounds, new ParallelOptions { MaxDegreeOfParallelism = parallel }, async (roundIndex, ct) =>
{
    var folder = Path.Combine(work, $"r{roundIndex}");
    var gameDoc = await SIDocument.ExtractToFolderAndLoadAsync(packPath, Path.Combine(folder, "package"), cancellationToken: ct);
    var server = new MediaServer(Path.Combine(folder, "package"));
    servers.Add(server);
    var names = MediaNames(gameDoc);
    var run = new RoundRun(roundIndex, gameDoc, server, seen);
    var total = seen.Rounds[roundIndex].Themes.Sum(t => t.Questions);
    // ход раунда — Ye!Studio показывает «вопрос N из M», пока идёт игра
    run.Progress = (n, ended) => Emit(new { type = "progress", round = roundIndex, name = seen.Rounds[roundIndex].Name, question = n, ended, total });
    var played = await run.PlayAsync(roundTimeout, stall);
    results.Add(played);

    // ---------- 4. медиа: всё, что движок разослал, запрашиваем у раздачи ----------
    var media = await server.FetchAllAsync(run.MediaUris);
    Emit(new { type = "round", round = roundIndex, name = seen.Rounds[roundIndex].Name, final = seen.Rounds[roundIndex].IsFinal, run.Messages, run.Questions, media, run.Errors, run.TimedOut, played, names });
});

Emit(new { type = "done", played = results.Sum(), expected = rounds.Sum(i => seen.Rounds[i].Themes.Sum(t => t.Questions)), seconds = (int)sw.Elapsed.TotalSeconds });

if (!exitAfter)
{
    // раздача живёт, пока Ye!Studio показывает вопросы на столе SIOnline
    await Console.In.ReadToEndAsync();
}

foreach (var s in servers) await s.DisposeAsync();
try { Directory.Delete(work, true); } catch { /* файлы ещё держит раздача — уберёт система */ }
return 0;

// SIGame распаковывает файлы под хэшами (ZipExtractorExtensions: UnzipNamingMode.Hash) — адреса в сообщениях
// выходят вида Images/25EDDF299A2AC7E6.png. Для отчёта — обратно к именам из пака, тем же TryGetMedia, что у движка.
static Dictionary<string, string> MediaNames(SIDocument doc)
{
    var map = new Dictionary<string, string>();
    foreach (var item in doc.Package.Rounds.SelectMany(r => r.Themes).SelectMany(t => t.Questions).SelectMany(Items))
    {
        if (!item.IsRef) continue;
        var uri = doc.TryGetMedia(item)?.Uri;
        if (uri == null) continue;
        var file = Path.GetFileName(uri.IsAbsoluteUri ? uri.LocalPath : uri.OriginalString);
        if (!string.IsNullOrEmpty(file)) map.TryAdd(file, item.Value);
    }
    return map;
}

static IEnumerable<ContentItem> Items(Question q)
{
    IEnumerable<ContentItem> Walk(StepParameter p) =>
        (p.ContentValue ?? []).Concat(p.GroupValue?.Values.SelectMany(Walk) ?? []);
    return q.Parameters.Values.SelectMany(Walk);
}

static RawPack ReadRaw(string path)
{
    using var zip = ZipFile.OpenRead(path);
    var entry = zip.GetEntry("content.xml") ?? throw new InvalidDataException("в архиве нет content.xml");
    using var s = entry.Open();
    return RawPack.Parse(XDocument.Load(s));
}

/// <summary>Структура пака: раунды → темы → число вопросов.</summary>
sealed record Structure(List<Structure.RoundInfo> Rounds)
{
    public sealed record RoundInfo(string Name, bool IsFinal, List<ThemeInfo> Themes);
    public sealed record ThemeInfo(string Name, int Questions);

    public int Themes => Rounds.Sum(r => r.Themes.Count);
    public int Questions => Rounds.Sum(r => r.Themes.Sum(t => t.Questions));
    public object Summary() => new { rounds = Rounds.Count, themes = Themes, questions = Questions };

    public static Structure From(Package p) => new(p.Rounds
        .Select(r => new RoundInfo(r.Name, r.Type == RoundTypes.Final, r.Themes.Select(t => new ThemeInfo(t.Name, t.Questions.Count)).ToList()))
        .ToList());

    /// <summary>Чего не хватает в <paramref name="seen"/> по сравнению с этим (файлом).</summary>
    public List<object> Compare(Structure seen)
    {
        var lost = new List<object>();
        for (var ri = 0; ri < Rounds.Count; ri++)
        {
            var r = Rounds[ri];
            var sr = ri < seen.Rounds.Count ? seen.Rounds[ri] : null;
            if (sr == null) { lost.Add(new { kind = "round", round = ri, name = r.Name }); continue; }
            for (var ti = 0; ti < r.Themes.Count; ti++)
            {
                var t = r.Themes[ti];
                var st = ti < sr.Themes.Count ? sr.Themes[ti] : null;
                if (st == null || st.Name != t.Name) { lost.Add(new { kind = "theme", round = ri, theme = ti, name = t.Name, seenAs = st?.Name }); continue; }
                if (st.Questions < t.Questions) lost.Add(new { kind = "questions", round = ri, theme = ti, name = t.Name, file = t.Questions, seen = st.Questions });
            }
        }
        return lost;
    }
}

/// <summary>content.xml, разобранный без SIPackages — «как в файле».</summary>
sealed record RawPack
{
    public required Structure Structure { get; init; }
    public object Summary() => Structure.Summary();
    public List<object> Compare(Structure seen) => Structure.Compare(seen);

    public static RawPack Parse(XDocument x)
    {
        IEnumerable<XElement> Kids(XElement? e, string name) => e?.Elements().Where(c => c.Name.LocalName == name) ?? [];
        XElement? Kid(XElement? e, string name) => Kids(e, name).FirstOrDefault();
        var rounds = Kids(Kid(x.Root, "rounds"), "round").Select(r => new Structure.RoundInfo(
            (string?)r.Attribute("name") ?? "",
            (string?)r.Attribute("type") == "final",
            Kids(Kid(r, "themes"), "theme").Select(t => new Structure.ThemeInfo(
                (string?)t.Attribute("name") ?? "",
                Kids(Kid(t, "questions"), "question").Count())).ToList())).ToList();
        return new RawPack { Structure = new Structure(rounds) };
    }
}

/// <summary>
/// Раздача файлов пака — как SIGame.ViewModel.Web.WebManager (те же пути /package/Images и т.д., та же
/// UseStaticFiles), только слушает 127.0.0.1, а не все адреса: иначе Windows при каждом прогоне спрашивает
/// про брандмауэр.
/// </summary>
sealed class MediaServer : IFileShare
{
    private readonly WebApplication _app;
    public int Port { get; }
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    public MediaServer(string packageFolder)
    {
        Port = FreePort();
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls($"http://127.0.0.1:{Port}");
        _app = builder.Build();
        foreach (var folder in new[] { CollectionNames.ImagesStorageName, CollectionNames.AudioStorageName, CollectionNames.VideoStorageName, CollectionNames.HtmlStorageName })
        {
            var path = Path.Combine(packageFolder, folder);
            if (Directory.Exists(path))
                _app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(path), RequestPath = $"/package/{folder}" });
        }
        _app.StartAsync().GetAwaiter().GetResult();
    }

    // как WebManager.CreateResourceUri
    public string CreateResourceUri(ResourceKind resourceKind, Uri relativePath) => resourceKind switch
    {
        ResourceKind.DefaultAvatar => $"{Constants.GameHostUri}:{Port}/defaultAvatars/{relativePath}",
        ResourceKind.Avatar => $"{Constants.GameHostUri}:{Port}/avatars/{relativePath}",
        _ => $"{Constants.GameHostUri}:{Port}/package/{relativePath}",
    };

    /// <summary>Адрес для браузера: заглушку хоста SIGame заменяет клиент — у нас это 127.0.0.1.</summary>
    public static string Resolve(string uri) => uri.Replace(Constants.GameHost, "127.0.0.1");

    public async Task<List<object>> FetchAllAsync(IEnumerable<(string Kind, string Uri, int Question)> uris)
    {
        var list = new List<object>();
        foreach (var (kind, uri, question) in uris.DistinctBy(u => (u.Uri, u.Question)))
        {
            var url = Resolve(uri);
            var sw = Stopwatch.StartNew();
            try
            {
                using var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseContentRead);
                var bytes = (await resp.Content.ReadAsByteArrayAsync()).LongLength;
                list.Add(new { question, kind, uri, url, status = (int)resp.StatusCode, bytes, contentType = resp.Content.Headers.ContentType?.MediaType, ms = sw.ElapsedMilliseconds });
            }
            catch (Exception e)
            {
                list.Add(new { question, kind, uri, url, status = 0, error = e.Message, ms = sw.ElapsedMilliseconds });
            }
        }
        return list;
    }

    private static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public ValueTask DisposeAsync() => _app.DisposeAsync();
}

/// <summary>Одна игра: раунд <see cref="Index"/> от начала до ROUND_END.</summary>
sealed class RoundRun(int Index, SIDocument Doc, MediaServer Server, Structure Seen)
{
    private const string ShowmanName = "Ведущий";
    private const string ViewerName = "Зритель";
    private static readonly string[] PlayerNames = ["Игрок 1", "Игрок 2"];

    private readonly object _lock = new();
    private readonly Stopwatch _clock = new();
    private readonly TaskCompletionSource _done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private DateTime _lastMessage = DateTime.UtcNow;

    private readonly List<List<bool>> _table = [];
    private readonly List<bool> _finalThemes = [];
    private bool _inRound;
    private bool _preambleDone;
    private int _current = -1;

    /// <summary>Всё, что получил зритель: [мс от начала, текст как есть, отправитель, системное ли].</summary>
    public List<object[]> Messages { get; } = [];
    public List<QuestionMark> Questions { get; } = [];
    public List<(string Kind, string Uri, int Question)> MediaUris { get; } = [];
    public List<string> Errors { get; } = [];
    public bool TimedOut { get; private set; }
    /// <summary>Вопрос начался или закончился: (сколько начато, сколько закончено).</summary>
    public Action<int, int>? Progress { get; set; }
    private DateTime _lastProgress = DateTime.UtcNow;

    public sealed record QuestionMark(int Theme, int Question, int Start)
    {
        public int End { get; set; } = -1;
        public string? Type { get; set; }
    }

    public async Task<int> PlayAsync(TimeSpan timeout, TimeSpan stall)
    {
        var node = new PrimaryNode(new NodeConfiguration());
        var settings = new GameSettingsCore<AppSettingsCore>
        {
            Showman = new Account { Name = ShowmanName, IsHuman = true },
            Players = PlayerNames.Select(n => new Account { Name = n, IsHuman = true }).ToArray(),
        };
        var game = GameRunner.CreateGame(
            node, settings,
            new SI.Contracts.RoomSettings { HostName = ShowmanName },
            new SI.Contracts.TimeSettings(),
            new SI.Contracts.RulesSettings { PlayAllThemesInThemesRemovalRound = true },
            "ru-RU", Doc, new Host(this), Server, [], [], new NoAvatars(), null, null);
        game.Run();

        var showman = Connect(game, node, ShowmanName, GameRole.Showman);
        var players = PlayerNames.Select(n => Connect(game, node, n, GameRole.Player)).ToArray();
        var viewer = Connect(game, node, ViewerName, GameRole.Viewer);
        _clock.Start();
        Send(showman, Messages_.Start);

        // «Дальше», как только движок замолчал: ждать таймеров игре незачем
        using var cts = new CancellationTokenSource();
        var mover = Task.Run(async () =>
        {
            while (!cts.IsCancellationRequested)
            {
                await Task.Delay(20);
                lock (_lock)
                {
                    if ((DateTime.UtcNow - _lastMessage).TotalMilliseconds > 50)
                    {
                        Send(showman, Messages_.Move, 1);
                        _lastMessage = DateTime.UtcNow;
                    }
                }
            }
        });

        // конец раунда, общий предел или игра давно не двигается от вопроса к вопросу
        var started = DateTime.UtcNow;
        while (!_done.Task.IsCompleted)
        {
            await Task.WhenAny(_done.Task, Task.Delay(1000));
            if (_done.Task.IsCompleted) break;
            DateTime last;
            lock (_lock) last = _lastProgress;
            var now = DateTime.UtcNow;
            if (now - started > timeout || now - last > stall) { TimedOut = true; break; }
        }
        cts.Cancel();
        await mover;
        lock (_lock)
        {
            return Questions.Count(q => q.End >= 0);
        }
    }

    private Client Connect(Game game, INode node, string name, GameRole role)
    {
        var c = new Client(name);
        c.MessageReceived += m =>
        {
            lock (_lock)
            {
                _lastMessage = DateTime.UtcNow;
                try { OnMessage(c, m); }
                catch (Exception e) { Errors.Add($"стенд: {e.Message}"); }
            }
            return ValueTask.CompletedTask;
        };
        c.ConnectTo(node);
        var res = game.Authenticate(name, false, role, null);
        if (res != AuthenticationResult.Ok) Errors.Add($"не удалось войти как {name}: {res}");
        return c;
    }

    private static void Send(Client c, params object[] a) =>
        c.SendMessage(string.Join(Message.ArgsSeparator, a), receiver: NetworkConstants.GameName);

    private void OnMessage(Client c, Message m)
    {
        var a = m.Text.Split(Message.ArgsSeparatorChar);
        if (c.Name == ViewerName) Record(m.Text, a, m.Sender, m.IsSystem);
        else Respond(c, a);
    }

    private void Record(string text, string[] a, string sender, bool isSystem)
    {
        if (a[0] == Messages_.Stage && a.Length > 1 && a[1] == "Round")
        {
            var idx = a.Length > 3 && int.TryParse(a[3], out var i) ? i : -1;
            if (idx == Index) { _inRound = true; _preambleDone = true; }
            else if (_inRound) { _done.TrySetResult(); return; }
            else { _preambleDone = true; return; }
        }

        if (a[0] == Messages_.Stage && a.Length > 1 && a[1] == "After" && _inRound) { _done.TrySetResult(); }
        // до первого раунда — общие сведения об игре (игроки, пак); чужие раунды пропускаем
        if (_preambleDone && !_inRound) return;

        Messages.Add([_clock.ElapsedMilliseconds, text, sender, isSystem]);
        var at = Messages.Count - 1;
        if (!_inRound) return;

        switch (a[0])
        {
            case Messages_.Choice when a.Length > 2:
                Begin(int.Parse(a[1]), int.Parse(a[2]), at);
                break;
            case Messages_.RoundThemes:
                _finalThemes.Clear();
                _finalThemes.AddRange(a.Skip(2).Select(_ => true));
                break;
            case Messages_.Theme when Seen.Rounds[Index].IsFinal && a.Length > 1:
                {
                    // финал: вопрос темы начинается с THEME, индекс темы — по имени, первая ещё не сыгранная
                    var themes = Seen.Rounds[Index].Themes;
                    var ti = Enumerable.Range(0, themes.Count).FirstOrDefault(i => themes[i].Name == a[1] && !Questions.Any(q => q.Theme == i), -1);
                    if (ti >= 0 && (_current < 0 || Questions[_current].End >= 0)) Begin(ti, 0, at);
                    break;
                }
            case Messages_.QType when _current >= 0 && a.Length > 1:
                Questions[_current].Type ??= a[1];
                break;
            case Messages_.Content or Messages_.Content2 or Messages_.ContentAppend:
                {
                    // CONTENT placement layout type value | CONTENT2 placement layout ? type ? value
                    var type = a[0] == Messages_.Content2 ? (a.Length > 4 ? a[4] : "") : (a.Length > 3 ? a[3] : "");
                    var value = a[^1];
                    if (type is ContentTypes.Image or ContentTypes.Audio or ContentTypes.Video or ContentTypes.Html && value.Contains("://"))
                        MediaUris.Add((type, value, _current));
                    break;
                }
            case Messages_.UserError or Messages_.GameError or Messages_.Atom_Hint:
                Errors.Add($"{(_current >= 0 ? $"вопрос {_current}: " : "")}{string.Join(" | ", a)}");
                break;
            case Messages_.QuestionEnd when _current >= 0:
                Questions[_current].End = at;
                Moved();
                break;
            case Messages_.RoundEnd:
                _done.TrySetResult();
                break;
        }
    }

    private void Begin(int theme, int question, int at)
    {
        if (_current >= 0 && Questions[_current].End < 0) Questions[_current].End = at - 1;
        Questions.Add(new QuestionMark(theme, question, at));
        _current = Questions.Count - 1;
        Moved();
    }

    private void Moved()
    {
        _lastProgress = DateTime.UtcNow;
        Progress?.Invoke(Questions.Count, Questions.Count(q => q.End >= 0));
    }

    /// <summary>Ответы ведущего и игроков: быстро и без выдумки — так, чтобы игра прошла каждый вопрос.</summary>
    private void Respond(Client c, string[] a)
    {
        var isShowman = c.Name == ShowmanName;
        switch (a[0])
        {
            case Messages_.Stage when isShowman && a.Length > 3 && a[1] == "Round":
                if (int.TryParse(a[3], out var idx) && idx < Index) Send(c, Messages_.Move, 3, Index);
                break;
            case Messages_.Table when isShowman:
                _table.Clear();
                var cur = new List<bool>();
                foreach (var x in a.Skip(1))
                {
                    if (x == "") { _table.Add(cur); cur = []; }
                    else cur.Add(x != "-1");
                }
                if (cur.Count > 0) _table.Add(cur);
                break;
            case Messages_.Choice when isShowman && a.Length > 2:
                if (int.TryParse(a[1], out var t) && int.TryParse(a[2], out var q) && t < _table.Count && q < _table[t].Count) _table[t][q] = false;
                break;
            case Messages_.RoundThemes when isShowman:
                _finalThemes.Clear();
                _finalThemes.AddRange(a.Skip(2).Select(_ => true));
                break;
            case Messages_.Out when isShowman && a.Length > 1:
                if (int.TryParse(a[1], out var o) && o < _finalThemes.Count) _finalThemes[o] = false;
                break;
            case Messages_.Choose when !isShowman:
                if (a.Length > 1 && a[1] == "2")
                {
                    var ft = _finalThemes.FindIndex(x => x);
                    if (ft >= 0) Send(c, Messages_.Delete, ft);
                }
                else
                {
                    for (var ti = 0; ti < _table.Count; ti++)
                        for (var qi = 0; qi < _table[ti].Count; qi++)
                            if (_table[ti][qi]) { Send(c, Messages_.Choice, ti, qi); return; }
                }
                break;
            case Messages_.AskSelectPlayer:
                {
                    var i = Enumerable.Range(0, Math.Max(0, a.Length - 2)).FirstOrDefault(i => a[i + 2] == "+", -1);
                    if (i >= 0) Send(c, Messages_.SelectPlayer, i);
                    break;
                }
            case Messages_.AskStake when a.Length > 2:
                {
                    var modes = a[1];
                    if (modes.Contains("Nominal")) Send(c, Messages_.SetStake, "Nominal");
                    else if (modes.Contains("Stake")) Send(c, Messages_.SetStake, "Stake", Math.Max(1, int.TryParse(a[2], out var min) ? min : 1));
                    else if (modes.Contains("AllIn")) Send(c, Messages_.SetStake, "AllIn");
                    else Send(c, Messages_.SetStake, "Pass");
                    break;
                }
            case Messages_.Answer when !isShowman:
                Send(c, Messages_.Answer, (a.Length > 1 ? a[1] : "") switch { "select" => "A", "number" => "0", "point" => "0.5,0.5", _ => "ответ" });
                break;
            case Messages_.AskValidate when isShowman && a.Length > 2:
                Send(c, Messages_.Validate, a[2], "+", 1);
                break;
            case Messages_.Validation or Messages_.Validation2 when isShowman:
                Send(c, Messages_.IsRight, "+", 1);
                break;
            case Messages_.Content2 when a.Contains(ContentTypes.Image) || a.Contains(ContentTypes.Video) || a.Contains(ContentTypes.Audio):
                Send(c, Messages_.MediaLoaded);
                break;
        }
    }

    private sealed class Host(RoundRun run) : IGameHost
    {
        public HostOptions Options { get; } = new();
        public void SendError(Exception exc, bool isWarning = false) { lock (run._lock) run.Errors.Add($"движок: {exc.GetType().Name}: {exc.Message}"); }
        // как в настольном SIGame (SIGame.ViewModel/Services/GameHost.cs)
        public int MaxImageSizeKb => int.MaxValue;
        public int MaxAudioSizeKb => int.MaxValue;
        public int MaxVideoSizeKb => int.MaxValue;
        public bool AreCustomAvatarsSupported => false;
        public void SaveReport(SICore.Results.GameResult result) { }
        public string? GetAd(string localization, out int adId) { adId = -1; return null; }
        public void LogWarning(string message) { lock (run._lock) run.Errors.Add($"движок: {message}"); }
    }

    private sealed class NoAvatars : IAvatarHelper
    {
        public bool FileExists(string fileName) => false;
        public (ErrorCode, string)? ExtractAvatarData(string base64data, string fileName) => null;
        public void AddFile(string sourceFilePath, string fileName) { }
    }
}

/// <summary>Имена сообщений SICore (SICore.Messages) под коротким именем, чтобы не путать с полем Messages.</summary>
static class Messages_
{
    public const string Answer = SICore.Messages.Answer;
    public const string AskSelectPlayer = SICore.Messages.AskSelectPlayer;
    public const string AskStake = SICore.Messages.AskStake;
    public const string AskValidate = SICore.Messages.AskValidate;
    public const string Atom_Hint = SICore.Messages.Atom_Hint;
    public const string Choice = SICore.Messages.Choice;
    public const string Choose = SICore.Messages.Choose;
    public const string Content = SICore.Messages.Content;
    public const string Content2 = SICore.Messages.Content2;
    public const string ContentAppend = SICore.Messages.ContentAppend;
    public const string Delete = SICore.Messages.Delete;
    public const string GameError = SICore.Messages.GameError;
    public const string IsRight = SICore.Messages.IsRight;
    public const string MediaLoaded = SICore.Messages.MediaLoaded;
    public const string Move = SICore.Messages.Move;
    public const string Out = SICore.Messages.Out;
    public const string QType = SICore.Messages.QType;
    public const string QuestionEnd = SICore.Messages.QuestionEnd;
    public const string RoundEnd = SICore.Messages.RoundEnd;
    public const string RoundThemes = SICore.Messages.RoundThemes;
    public const string SelectPlayer = SICore.Messages.SelectPlayer;
    public const string SetStake = SICore.Messages.SetStake;
    public const string Stage = SICore.Messages.Stage;
    public const string Start = SICore.Messages.Start;
    public const string Table = SICore.Messages.Table;
    public const string Theme = SICore.Messages.Theme;
    public const string UserError = SICore.Messages.UserError;
    public const string Validate = SICore.Messages.Validate;
    public const string Validation = SICore.Messages.Validation;
    public const string Validation2 = SICore.Messages.Validation2;
}
