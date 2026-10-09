# WebKit Playwright не запускался локально на macOS 14.3.1

**Решено 9 октября 2026 года обновлением macOS до 27.0.1.** Playwright 1.63 скачал обычную сборку
`webkit-2359` (WebKit 26.6) вместо `webkit_mac14_arm64_special-2251`; запускается стабильно,
все 108 WebKit-тестов проходят. После обновления системы выполните `npx playwright install webkit`.

Первый же прогон нашёл то, что Chromium не видит: нативный `<select>` в WebKit остаётся высотой 23 px,
какую бы высоту ему ни задали, пока не выключен `appearance`. Поля выбора оформляются через
`.ui-select-field` или с `appearance: none` и своей стрелкой. Init-скрипты Playwright в WebKit не
выполняются на `about:blank` — проверки фикстур ведите на странице приложения.

## Как было

Проверено 9 октября 2026 года на Apple M1 Max, macOS 14.3.1 (23D60), Playwright 1.63.0,
сборка `webkit_mac14_arm64_special-2251`.

### Симптом

Все тесты проекта `webkit` (`layout-invariants`, `mobile-controls`, `silent-media`) падают ещё до
открытия страницы:

```
browserType.launch: Target page, context or browser has been closed
pw_run.sh: line 7: … Bus error: 10
```

Отчёт `~/Library/Logs/DiagnosticReports/Playwright-*.ips`: `EXC_BAD_ACCESS / SIGBUS,
KERN_PROTECTION_FAILURE` в `libobjc map_images` при инициализации `libSystem`, то есть в загрузчике
до кода браузера. Такие отчёты появляются с 3 октября; запуск WebKit через Codex 8 октября упал так же
(`/tmp/otgolosok-legal-webkit.log`).

### Что проверено

- Песочница Claude Code ни при чём: вне её падение то же. Локаль (`LC_ALL=en_US.UTF-8`) не влияет.
- Подпись ad-hoc проходит `codesign --verify --deep`, атрибутов карантина нет.
- `npx playwright install --force webkit` помогает ровно на один запуск: первый запуск после распаковки
  работает, все следующие снова падают. Новых файлов первый запуск ни в каталоге сборки, ни в кэшах
  пользователя не оставляет — ломается состояние на уровне системы.

### Что делали бы без обновления

Локально WebKit-проверки были недоступны, Chromium работал. Вероятная причина — сборка Playwright
для macOS 14 рассчитана на более новую версию системы, чем 14.3.1. Варианты по надёжности: обновить
macOS до последней 14.x или 15; запускать проект `webkit` в Linux-контейнере Playwright; прогонять
WebKit-проверки в CI. Переустановка сборки перед каждым запуском не подходит: Playwright запускает
браузер для каждого воркера.
