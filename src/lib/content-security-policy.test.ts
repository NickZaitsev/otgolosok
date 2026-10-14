import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestToneDataUri } from "@/lib/audio/audio-element";
import { contentSecurityPolicy, inlineScriptHashes, isVerificationFile, withContentSecurityPolicy } from "../../scripts/content-security-policy.mjs";

const hash = (body: string) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
const policyOf = (html: string) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";

describe("content security policy", () => {
  it("разрешает только плеер YouTube с расширенной конфиденциальностью во фрейме", () => {
    const directives = contentSecurityPolicy([]).split("; ");
    expect(directives.find(value => value.startsWith("frame-src "))).toContain("https://www.youtube-nocookie.com");
    for (const name of ["script-src", "connect-src", "img-src", "media-src"]) {
      expect(directives.find(value => value.startsWith(name + " "))).not.toContain("youtube");
    }
    expect(contentSecurityPolicy([])).not.toContain("https://www.youtube.com");
  });
  it("разрешает встраивание Docker-сайта только интерфейсам Метрики", () => {
    const headers = readFileSync(new URL("../../docker/security-headers.conf", import.meta.url), "utf8");
    const ancestors = /frame-ancestors ([^;]+)/.exec(headers)?.[1].split(" ") ?? [];
    expect(ancestors).toContain("https://metrika.yandex.ru");
    expect(ancestors).toContain("https://metrica.yandex.ru");
    expect(ancestors.every(origin => /^https:\/\/(?:analytics|metr|metrica|metrika)\.(?:yandex(?:\.[a-z.]+)?|ya\.ru)$/.test(origin))).toBe(true);
    expect(headers).not.toContain("add_header X-Frame-Options");
  });
  it("разрешает только inline-скрипты страницы по их хешу", () => {
    const html = `<!DOCTYPE html><html><head><meta charSet="utf-8"/><script src="/_next/a.js" async=""></script></head>`
      + `<body><script>self.__next_f.push([1,"Привет"])</script><script id="x">(self.__next_f=[]).push(0)</script></body></html>`;
    const policy = policyOf(withContentSecurityPolicy(html));
    expect(policy).toContain(hash(`self.__next_f.push([1,"Привет"])`));
    expect(policy).toContain(hash("(self.__next_f=[]).push(0)"));
    expect(policy).not.toContain("'unsafe-inline' 'sha256");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).toContain("object-src 'none'");
  });

  it("не хеширует внешние и пустые скрипты", () => {
    expect(inlineScriptHashes(`<script src="/a.js"></script><script async src='/b.js'></script><script></script>`)).toEqual([]);
    expect(contentSecurityPolicy([])).toMatch(/^default-src 'self'; script-src 'self' https:\/\/mc.yandex.ru /);
  });

  it("сохраняет источники карты и воркер MapLibre", () => {
    const directive = (name: string) => contentSecurityPolicy([]).split("; ").find(d => d.startsWith(`${name} `));
    expect(directive("connect-src")).toContain("connect-src 'self' https://tiles.versatiles.org ");
    expect(directive("img-src")).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org ");
    expect(directive("img-src")).toContain("https://live.staticflickr.com");
    expect(directive("script-src")).not.toContain("flickr");
    expect(directive("worker-src")).toBe("worker-src 'self' blob:");
    expect(directive("script-src")).toContain("script-src 'self' https://mc.yandex.ru ");
  });

  it("пропускает тихий клип разблокировки звука и не открывает внешние источники медиа", () => {
    // iOS grants playback to the element that played this clip from the tap.
    const scheme = new URL(createTestToneDataUri({ durationSeconds: 0.15, amplitude: 0 })).protocol;
    const media = contentSecurityPolicy([]).split("; ").find(d => d.startsWith("media-src "))!.split(" ").slice(1);
    expect(media).toContain(scheme);
    expect(media).toEqual(["'self'", "data:"]);
  });

  it("разрешает точные адреса Метрики и Вебвизора без wildcard и unsafe-eval", () => {
    const policy = contentSecurityPolicy([]);
    const directive = (name: string) => policy.split("; ").find(d => d.startsWith(`${name} `))!;
    for (const name of ["script-src", "connect-src", "img-src", "frame-src", "child-src"]) {
      expect(directive(name)).toContain("https://mc.yandex.ru");
      expect(directive(name)).toContain("https://mc.yandex.com.tr");
      expect(directive(name)).toContain("https://mc.webvisor.org");
    }
    expect(directive("script-src")).toContain("https://yastatic.net");
    expect(directive("connect-src")).toContain("wss://mc.yandex.ru");
    expect(policy).not.toMatch(/\*|unsafe-eval/);
  });

  it("ставит политику до первого скрипта и не дублирует её при повторной сборке", () => {
    const html = `<html><head><meta charset="utf-8"><script>a()</script></head></html>`;
    const once = withContentSecurityPolicy(html);
    const twice = withContentSecurityPolicy(once);
    expect(twice).toBe(once);
    expect(once.indexOf("Content-Security-Policy")).toBeLessThan(once.indexOf("<script"));
  });

  it("использует <head>, если нет charset, и отказывает для страницы без head", () => {
    expect(withContentSecurityPolicy("<html><head><title>x</title></head></html>")).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy"/);
    expect(() => withContentSecurityPolicy("<p>fragment</p>")).toThrow(/head/);
  });

  it("отказывает, если скрипт стоит раньше мест для политики", () => {
    expect(() => withContentSecurityPolicy(`<html><script>a()</script><head><meta charset="utf-8"></head></html>`)).toThrow(/before the first script/);
  });

  it.each([
    ["googlec7e66ec25aa44d3a.html", true], ["yandex_0123abcd.html", true], ["sub/googleabc.html", true],
    ["index.html", false], ["google.html", false], ["googlec7e66ec25aa44d3a.html.bak", false], ["mygoogleabc.html", false], ["yandex_.html", false],
  ])("файл подтверждения поисковика %s не получает политику: %s", (path, expected) => {
    expect(isVerificationFile(path)).toBe(expected);
  });

  it("файл подтверждения Google в public отдаётся как есть и признан таким файлом", () => {
    const file = "google2b262378fb391034.html";
    expect(isVerificationFile(file)).toBe(true);
    expect(readFileSync(new URL(`../../public/${file}`, import.meta.url), "utf8")).toBe(`google-site-verification: ${file}`);
  });
});
