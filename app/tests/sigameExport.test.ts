// «Сохранить отчёт» (core/sigame/exportHtml.ts): один HTML — беды, снимки только вопросов с бедами, полный JSON.
import { describe, expect, it } from "vitest";
import { escapeHtml, exportHtml, questionKey, shotsToExport } from "../src/core/sigame/exportHtml";
import type { QuestionReport, SigameReport } from "../src/core/sigame/report";

const at = (question: number) => ({ round: 0, theme: 1, question });
const q = (question: number, issues: QuestionReport["issues"]): QuestionReport => ({
  at: at(question), type: "simple", issues,
  shots: (["phone", "phoneLand", "pc"] as const).map((profile) => ({ profile, part: "question" as const, n: 1, file: `q${question}-${profile}.jpg` })),
});
const warn = (text: string, profiles: QuestionReport["issues"][0]["profiles"], question = 0) => ({ level: "warn" as const, text, at: at(question), profiles, source: "table" as const });

describe("сохранение отчёта", () => {
  it("снимки — только экраны, где видна беда; беда без экрана — все снимки", () => {
    expect(shotsToExport(q(0, [warn("мелко", ["phoneLand"])])).map((s) => s.profile)).toEqual(["phoneLand"]);
    expect(shotsToExport(q(0, [{ ...warn("нет файла", []), level: "error", source: "engine" }])).map((s) => s.profile)).toEqual(["phone", "phoneLand", "pc"]);
  });

  it("в файле — только вопросы с бедами, подписи мест, экранированный текст и полный JSON, который не рвёт script", () => {
    const bad = q(1, [warn("Картинка <b>&\"x\".jpg на телефоне", ["phone"], 1)]);
    const report: SigameReport = {
      opened: true, file: { rounds: 1, themes: 2, questions: 2 }, played: 2, expected: 2, seconds: 5,
      issues: [...bad.issues, { level: "error", text: "SIGame не видит тему </script>", at: { round: 0, theme: 1 }, profiles: [], source: "engine" }],
      questions: [q(0, []), bad],
    };
    const html = exportHtml({
      report, title: "Уе!пак <10>", at: "2026-09-28T07:00:00Z",
      labels: { [questionKey(at(1))]: "Раунд 1 › Музыка · 200", [questionKey({ round: 0, theme: 1 })]: "Раунд 1 › Музыка" },
      images: { "q1-phone.jpg": "data:image/jpeg;base64,AAA", "q0-phone.jpg": "data:image/jpeg;base64,BBB" },
    });
    expect(html).toContain("<title>Прогон в SIGame — Уе!пак &lt;10&gt;</title>");
    expect(html).toContain("<b>Ошибок: 1</b> · внимание: 1 · вопросов с бедами: 1 из 2");
    expect(html).toContain("<h3>Раунд 1 › Музыка · 200</h3>");
    expect(html).toContain("Картинка &lt;b&gt;&amp;&quot;x&quot;.jpg на телефоне");
    expect(html).toContain("Раунд 1 › Музыка: SIGame не видит тему &lt;/script&gt;");
    expect(html).toContain('src="data:image/jpeg;base64,AAA"');
    expect(html).not.toContain("BBB");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const json = html.slice(html.indexOf('id="report">') + 12, html.lastIndexOf("</script>"));
    expect(JSON.parse(json)).toEqual(report);
  });

  it("чистый пак", () => {
    const html = exportHtml({ report: { opened: true, played: 1, expected: 1, seconds: 1, issues: [], questions: [q(0, [])] }, title: "П", at: "2026-09-28T07:00:00Z", labels: {}, images: {} });
    expect(html).toContain("<b>Ошибок нет</b>");
    expect(html).toContain("У вопросов бед нет");
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
