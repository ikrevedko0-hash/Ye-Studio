// Независимая проверка .siq официальной библиотекой SIPackages (та же, что в SIQuester и SIGame).
// Вывод — одна строка JSON на пак: счётчики и список битых ссылок на медиа.
using System.Text.Json;
using SIPackages;

Console.OutputEncoding = System.Text.Encoding.UTF8;
var jsonOptions = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

foreach (var path in args)
{
    try
    {
        using var stream = File.OpenRead(path);
        using var doc = SIDocument.Load(stream, true, null);
        var pkg = doc.Package;
        int themes = 0, questions = 0, items = 0, refs = 0;
        var missing = new List<string>();

        void CheckItems(IEnumerable<ContentItem> list)
        {
            foreach (var item in list)
            {
                items++;
                if (!item.IsRef) continue;
                refs++;
                var collection = doc.TryGetCollection(item.Type);
                if (collection == null || !collection.Contains(item.Value)) missing.Add($"{item.Type}:{item.Value}");
            }
        }

        void CheckParam(StepParameter p)
        {
            if (p.ContentValue != null) CheckItems(p.ContentValue);
            if (p.GroupValue != null) foreach (var child in p.GroupValue.Values) CheckParam(child);
        }

        foreach (var round in pkg.Rounds)
            foreach (var theme in round.Themes)
            {
                themes++;
                foreach (var q in theme.Questions)
                {
                    questions++;
                    foreach (var p in q.Parameters.Values) CheckParam(p);
                }
            }

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            path = Path.GetFileName(path),
            ok = true,
            name = pkg.Name,
            rounds = pkg.Rounds.Count,
            themes,
            questions,
            items,
            refs,
            images = doc.Images.Count,
            audio = doc.Audio.Count,
            video = doc.Video.Count,
            quality = pkg.HasQualityControl,
            missing,
        }, jsonOptions));
    }
    catch (Exception ex)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { path = Path.GetFileName(path), ok = false, error = ex.GetType().Name + ": " + ex.Message }, jsonOptions));
    }
}
