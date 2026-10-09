# WebKit Playwright не запускается локально на macOS 14.3.1

Проверено 9 октября 2026 года на Apple M1 Max, macOS 14.3.1 (23D60), Playwright 1.63.0,
сборка `webkit_mac14_arm64_special-2251`.

## Симптом

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

## Что проверено

- Песочница Claude Code ни при чём: вне её падение то же. Локаль (`LC_ALL=en_US.UTF-8`) не влияет.
- Подпись ad-hoc проходит `codesign --verify --deep`, атрибутов карантина нет.
- `npx playwright install --force webkit` помогает ровно на один запуск: первый запуск после распаковки
  работает, все следующие снова падают. Новых файлов первый запуск ни в каталоге сборки, ни в кэшах
  пользователя не оставляет — ломается состояние на уровне системы.

## Что делать

Локально WebKit-проверки сейчас недоступны; Chromium работает. Вероятная причина — сборка Playwright
для macOS 14 рассчитана на более новую версию системы, чем 14.3.1. Варианты по надёжности: обновить
macOS до последней 14.x или 15; запускать проект `webkit` в Linux-контейнере Playwright; прогонять
WebKit-проверки в CI. Переустановка сборки перед каждым запуском не подходит: Playwright запускает
браузер для каждого воркера.
