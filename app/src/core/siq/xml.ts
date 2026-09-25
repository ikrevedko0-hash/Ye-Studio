// Разбор и сборка content.xml пака SIQ v5.
// Сборщик пишет компактный XML в том же порядке и с теми же экранированиями, что SIQuester,
// чтобы открытый и сохранённый без правок пак совпадал с оригиналом байт в байт.

import { DOMParser, XMLSerializer, type Element as XElement, type Node as XNode } from "@xmldom/xmldom";
import type { ContentItem, Info, NumberSet, Package, Param, ParamChild, Question, Round, Theme } from "./model";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

function elements(el: XElement): XElement[] {
  const out: XElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === ELEMENT_NODE) out.push(n as XElement);
  return out;
}

function textOf(el: XElement): string {
  return el.textContent ?? "";
}

function attr(el: XElement, name: string): string | undefined {
  return el.hasAttribute(name) ? el.getAttribute(name)! : undefined;
}

function name(el: XElement): string {
  return el.localName ?? el.nodeName;
}

const raw = (n: XNode) => new XMLSerializer().serializeToString(n as never);

function parseList(el: XElement): string[] {
  return elements(el).map(textOf);
}

function parseInfo(el: XElement): Info {
  const info: Info = {};
  for (const c of elements(el)) {
    switch (name(c)) {
      case "authors": info.authors = parseList(c); break;
      case "sources": info.sources = parseList(c); break;
      case "comments": info.comments = textOf(c); break;
      case "showmanComments": info.showmanComments = textOf(c); break;
      case "extension": info.extension = textOf(c); break;
    }
  }
  return info;
}

function parseItem(el: XElement): ContentItem {
  return {
    type: attr(el, "type"),
    isRef: attr(el, "isRef"),
    placement: attr(el, "placement"),
    duration: attr(el, "duration"),
    waitForFinish: attr(el, "waitForFinish"),
    value: textOf(el),
  };
}

function parseNumberSet(el: XElement): NumberSet {
  const ns: NumberSet = { minimum: attr(el, "minimum"), maximum: attr(el, "maximum"), step: attr(el, "step") };
  const t = textOf(el);
  if (t) ns.value = t;
  return ns;
}

function parseParam(el: XElement): Param {
  const p: Param = { name: attr(el, "name"), type: attr(el, "type"), children: [] };
  let text = "";
  let hasText = false;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === TEXT_NODE || n.nodeType === CDATA_NODE) {
      text += n.nodeValue ?? "";
      hasText = true;
    } else if (n.nodeType === ELEMENT_NODE) {
      const c = n as XElement;
      const child: ParamChild | null =
        name(c) === "item" ? { kind: "item", item: parseItem(c) }
        : name(c) === "param" ? { kind: "param", param: parseParam(c) }
        : name(c) === "numberSet" ? { kind: "numberSet", numberSet: parseNumberSet(c) }
        : null;
      if (child) p.children.push(child);
    }
  }
  if (hasText && (p.children.length === 0 || text.trim() !== "")) p.text = text;
  // <param name="x"></param> — простой параметр с пустым значением (SIQuester пишет его парой тегов)
  else if (!hasText && p.children.length === 0 && p.type === undefined) p.text = "";
  return p;
}

function parseParams(el: XElement): Param[] {
  return elements(el).filter((c) => name(c) === "param").map(parseParam);
}

function parseQuestion(el: XElement): Question {
  const q: Question = { price: attr(el, "price") ?? "0", type: attr(el, "type"), right: [] };
  for (const c of elements(el)) {
    switch (name(c)) {
      case "info": q.info = parseInfo(c); break;
      case "params": q.params = parseParams(c); break;
      case "right": q.right = parseList(c); break;
      case "wrong": q.wrong = parseList(c); break;
      default: (q.legacyXml ??= []).push(raw(c));
    }
  }
  return q;
}

function parseTheme(el: XElement): Theme {
  const t: Theme = { name: attr(el, "name") ?? "" };
  for (const c of elements(el)) {
    if (name(c) === "info") t.info = parseInfo(c);
    else if (name(c) === "questions") t.questions = elements(c).map(parseQuestion);
  }
  return t;
}

function parseRound(el: XElement): Round {
  const r: Round = { name: attr(el, "name") ?? "", type: attr(el, "type") };
  for (const c of elements(el)) {
    if (name(c) === "info") r.info = parseInfo(c);
    else if (name(c) === "themes") r.themes = elements(c).map(parseTheme);
  }
  return r;
}

export function parseContentXml(xml: string): Package {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => { if (level !== "warning") errors.push(msg); },
  }).parseFromString(xml.replace(/^﻿/, ""), "text/xml");
  if (errors.length) throw new Error("content.xml повреждён: " + errors[0]);
  const root = doc.documentElement as unknown as XElement;
  if (!root || name(root) !== "package") throw new Error("content.xml: нет корневого <package>");

  const pkg: Package = { attrs: [], order: [] };
  for (let i = 0; i < root.attributes.length; i++) {
    const a = root.attributes.item(i)!;
    pkg.attrs.push([a.name, a.value]);
  }
  for (const c of elements(root)) {
    const n = name(c);
    pkg.order.push(n);
    switch (n) {
      case "tags": pkg.tags = parseList(c); break;
      case "files": pkg.files = elements(c).map((f) => ({ name: attr(f, "name") ?? "", hash: attr(f, "hash") ?? "" })); break;
      case "info": pkg.info = parseInfo(c); break;
      case "global": pkg.globalXml = raw(c); break;
      case "rounds": pkg.rounds = elements(c).map(parseRound); break;
    }
  }
  return pkg;
}

// ---------- сборка ----------

// SIQuester (.NET XmlWriter, NewLineHandling.Replace) пишет переводы строк в тексте как \r\n.
// Парсер XML нормализует их в \n, поэтому при записи возвращаем \r\n.
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "\r\n");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrs(pairs: [string, string | undefined][]): string {
  return pairs.filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${escAttr(v!)}"`).join("");
}

/** pair=true — писать пустой элемент парой тегов <x></x> (так XmlWriter делает после WriteString("")). */
function elem(tag: string, attrStr: string, inner: string, pair = false): string {
  return inner === "" && !pair ? `<${tag}${attrStr} />` : `<${tag}${attrStr}>${inner}</${tag}>`;
}

function list(tag: string, itemTag: string, items: string[] | undefined): string {
  if (items === undefined) return "";
  return elem(tag, "", items.map((s) => elem(itemTag, "", escText(s))).join(""));
}

function buildInfo(info: Info | undefined): string {
  if (!info) return "";
  let s = list("authors", "author", info.authors) + list("sources", "source", info.sources);
  if (info.comments !== undefined) s += elem("comments", "", escText(info.comments));
  if (info.showmanComments !== undefined) s += elem("showmanComments", "", escText(info.showmanComments));
  if (info.extension !== undefined) s += elem("extension", "", escText(info.extension));
  return elem("info", "", s);
}

function buildItem(it: ContentItem): string {
  const a = attrs([["type", it.type], ["isRef", it.isRef], ["placement", it.placement], ["duration", it.duration], ["waitForFinish", it.waitForFinish]]);
  return elem("item", a, escText(it.value), true);
}

function buildParam(p: Param): string {
  const pair = p.text !== undefined;
  let inner = pair ? escText(p.text!) : "";
  for (const c of p.children) {
    if (c.kind === "item") inner += buildItem(c.item);
    else if (c.kind === "param") inner += buildParam(c.param);
    else inner += elem("numberSet", attrs([["minimum", c.numberSet.minimum], ["maximum", c.numberSet.maximum], ["step", c.numberSet.step]]), escText(c.numberSet.value ?? ""));
  }
  return elem("param", attrs([["name", p.name], ["type", p.type]]), inner, pair);
}

function buildQuestion(q: Question): string {
  let s = buildInfo(q.info) + (q.legacyXml ?? []).join("");
  if (q.params) s += elem("params", "", q.params.map(buildParam).join(""));
  s += list("right", "answer", q.right);
  s += list("wrong", "answer", q.wrong);
  return elem("question", attrs([["price", q.price], ["type", q.type]]), s);
}

function buildTheme(t: Theme): string {
  let s = buildInfo(t.info);
  if (t.questions) s += elem("questions", "", t.questions.map(buildQuestion).join(""));
  return elem("theme", attrs([["name", t.name]]), s);
}

function buildRound(r: Round): string {
  let s = buildInfo(r.info);
  if (r.themes) s += elem("themes", "", r.themes.map(buildTheme).join(""));
  return elem("round", attrs([["name", r.name], ["type", r.type]]), s);
}

const DEFAULT_ORDER = ["tags", "files", "info", "global", "rounds"];

export function buildContentXml(pkg: Package): string {
  const order = [...pkg.order, ...DEFAULT_ORDER.filter((n) => !pkg.order.includes(n))];
  let body = "";
  for (const n of order) {
    switch (n) {
      case "tags": body += list("tags", "tag", pkg.tags); break;
      case "files":
        if (pkg.files) body += elem("files", "", pkg.files.map((f) => elem("file", attrs([["name", f.name], ["hash", f.hash]]), "")).join(""));
        break;
      case "info": body += buildInfo(pkg.info); break;
      case "global": body += pkg.globalXml ?? ""; break;
      case "rounds": if (pkg.rounds) body += elem("rounds", "", pkg.rounds.map(buildRound).join("")); break;
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>` + elem("package", attrs(pkg.attrs), body);
}
