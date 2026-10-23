# Мобильное приложение на Flutter

Нативное Android-приложение лежит в `mobile-flutter/`. Оно заменяет Capacitor-оболочку
из `mobile/` и решает главную задачу: прогулка продолжается с выключенным экраном.
Решения и история — в плане
[plans/2026-10-23-flutter-mobile-app.md](plans/2026-10-23-flutter-mobile-app.md).

## Устройство

- `lib/core/` — конфигурация, API-клиент, сессия, хранилища, i18n, ссылки.
  - `ApiClient` (dio): заголовок `Origin`, CSRF на записи, повтор 5xx/429/сетевых ошибок
    (3 попытки, 500·2ⁿ мс, `Retry-After` до 5 с).
  - Записи без идемпотентности не повторяются.
  - Ответы проверяются валидаторами: что не прошло проверку, становится ошибкой `CORRUPT`.
  - Cookie сессии хранятся в `flutter_secure_storage` (`SecureCookieStorage`).
  - Отладочный лог маскирует cookie, CSRF, ключ отзыва и одноразовые коды.
- `lib/walk_engine/` — движок прогулки на чистом Dart. Это перенос `src/lib/geo`,
  `src/features/tour` и `tour-experience.tsx`.
  - `WalkSession` получает координаты и события плеера.
  - Наружу он отдаёт команды плееру, состояние экрана и карточку уведомления.
- `packages/walk_service/` — локальный плагин на Kotlin с Pigeon-контрактом
  `pigeons/walk_service_api.dart`.
  - `WalkService : MediaSessionService` держит foreground-службу `location|mediaPlayback`
    всю прогулку.
  - Внутри: Fused/LocationManager, ExoPlayer с кэшем 200 МБ, медиакарточка с кнопками
    «15 с назад», «Дальше», «Стоп».
  - На Android 16+ добавляется Live Update «Путь к точке».
- `lib/features/*` — экраны. Навигация повторяет сайт: «Рядом», «Прогулка», «Тренды», «Профиль».
- `OtgolosokApplication` создаёт Flutter-движок и кладёт его в `FlutterEngineCache`, а
  `MainActivity` к нему подключается. Поэтому служба переживает закрытие активности.

## Сборка на Windows

Нужны Flutter 3.47, JDK 21 и Android SDK (platform 36, build-tools, NDK из `flutter.ndkVersion`).
Gradle берёт JDK из `JAVA_HOME`.

```bash
pnpm mobile-flutter:check
```

```bash
cd mobile-flutter && flutter build apk --debug
```

- Отладочная сборка ставится как `online.otgolosok.app.dev` («Отголосок (dev)») рядом с
  Capacitor-приложением.
- Релиз использует `online.otgolosok.app` и при выходе в магазин заменит Capacitor-версию.
- Адрес API задаётся через `--dart-define=OTGOLOSOK_API_ORIGIN=…`, по умолчанию production.
- `http://` разрешён только вместе с `--dart-define=OTGOLOSOK_DEV=true`, например
  `http://10.0.2.2:3000` для эмулятора.

Модульные тесты плагина гоняются через Robolectric:

```bash
cd mobile-flutter/android && ./gradlew :walk_service:testDebugUnitTest
```

Robolectric на JDK 21 требует `--add-opens`. Флаги уже прописаны в
`packages/walk_service/android/build.gradle.kts`.

## Файлы, которые генерирует сайт

Словари, стиль карты, иконки, цветовые токены и эталонные данные для тестов Dart выгружает
Vitest. Эти тесты лежат в файлах `*.mobile-export.test.ts`, их помощник —
`src/lib/mobile-export/snapshot.ts`.

```bash
npx vitest run -u mobile-export
```

- После правки словарей, токенов, стиля карты или моделей API сайта перегенерируйте выгрузку
  и закоммитьте её вместе с изменением.
- Dart-тесты (`test/walk_engine`, `test/fixtures`) сверяют движок и разбор ответов с этими
  эталонами.
- Строки, которые есть только в приложении, лежат вручную в `assets/i18n/app/<область>.json`.
- Одинаковая русская строка не может переводиться по-разному: `Translations.merge` падает.
- Тест требует перевод для каждой строки, переданной в `context.t('…')`.

## Подпись релиза

Используется тот же upload-ключ, что у Capacitor-приложения. Ключ берётся из
`mobile-flutter/android/key.properties` (файл в `.gitignore`) или из переменных
`OTGOLOSOK_KEYSTORE_FILE`, `OTGOLOSOK_KEYSTORE_PASSWORD`, `OTGOLOSOK_KEY_ALIAS` и
`OTGOLOSOK_KEY_PASSWORD`. Неподписанный релиз собрать нельзя: Gradle останавливает сборку с
подсказкой.

## Вход через Telegram

Приложение открывает `/app-auth/telegram` в Custom Tab с PKCE challenge. Сайт выдаёт
одноразовый код через `POST /api/mobile-auth/handoff`, приложение обменивает его на сессию через
`POST /api/mobile-auth/exchange`. Код живёт недолго и используется один раз. Маршрут закрыт в
`robots.txt`.

## Что не проверено

- Шаг 0 плана не выполнялся: замеры на реальном телефоне с выключенным экраном.
- Шаг 9 не выполнялся: полевая прогулка.
- Шаг 10 не выполнялся: публикация в Google Play и RuStore.
- Только на устройстве проверяются:
  - удержание foreground-службы дольше 10 минут без звука;
  - поведение Doze и OEM-оптимизаций батареи;
  - Live Update на Android 16;
  - Fused против LocationManager на телефонах без Google Play.
