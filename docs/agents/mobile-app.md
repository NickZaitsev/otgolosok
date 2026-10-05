# Android-приложение

План: [docs/agents/plans/2026-10-05-mobile-store-apps.md](plans/2026-10-05-mobile-store-apps.md). Сейчас делается только Android (Google Play и RuStore); iOS отложен.

## Как устроено

- Приложение — нативная оболочка Capacitor 8 (`mobile/android`), которая **открывает настоящий сайт** `https://otgolosok.online` (`server.url` в `mobile/capacitor-config.ts`). Сайт в приложение не упакован: выкладка сайта сразу видна в приложении, релиз в магазин нужен только при изменении нативной части.
- Поэтому без изменений работают cookie входа `__Host-otgolosok-session`, CSRF, относительные `/api/...`, Service Worker с офлайн-копией и ссылки «Поделиться» из `location.origin`.
- Capacitor официально называет `server.url` режимом разработки. Мы осознанно пользуемся им в релизе; компенсации ниже.
- Конфигурация: корневой `capacitor.config.ts` вызывает `buildCapacitorConfig(process.env)` из `mobile/capacitor-config.ts` (тест рядом). `OTGOLOSOK_APP_URL` меняет адрес сайта, `OTGOLOSOK_APP_DEV=1` разрешает `http://` для `pnpm dev` в локальной сети. Для магазинных сборок оба не задаются.
- `appId` — `online.otgolosok.app`. **Изменить нельзя** после первой загрузки в магазин.

### Мост Capacitor и CSP

На сайте CSP без `'unsafe-inline'` (`scripts/content-security-policy.mjs`). Capacitor Android подключает свой мост к удалённой странице через `WebViewCompat.addDocumentStartJavaScript`, если WebView поддерживает `DOCUMENT_START_SCRIPT`. Тогда HTML не переписывается и CSP мост не блокирует (`Bridge.loadWebView()` в `@capacitor/android`). Без этой функции Capacitor вставил бы инлайн-скрипт в HTML через свой прокси, и CSP его бы заблокировала.

Поэтому `android.minWebViewVersion = 111`: столько же требует Next.js 16 (Chrome 111+), и это заметно выше версии, где появились document-start-скрипты. На более старом WebView приложение показывает `app-error.html` с советом обновить Android System WebView.

### Страница ошибки

`mobile/www/app-error.html` лежит внутри приложения и открывается по адресу `https://otgolosok.online/app-error.html`, если сайт не загрузился. На сайте такого пути нет и быть не должно. Кнопка «Повторить» открывает `/`. Если на телефоне уже есть офлайн-копия, навигацию может обслужить Service Worker сайта.

### Связь сайта с приложением

- `src/lib/native/platform.ts` — `nativePlatform()` и `hasNativePlugin(name)` читают `window.Capacitor`, который вставляет оболочка. `@capacitor/core` не импортируется статически, веб-бандл не меняется; код плагинов грузится динамическим `import()` только в приложении.
- **Правило старых сборок:** сайт обновляется мгновенно, а у людей остаются старые версии приложения. Любая нативная функция проверяет `hasNativePlugin(...)` и иначе работает как в браузере.
- Запрет гашения экрана на прогулке: `src/lib/native/keep-awake.ts` (в Android WebView нет Screen Wake Lock API).
- «Поделиться» местом: `src/features/explore/app-share.ts` (в Android WebView нет Web Share API). Закрытое окно — `cancelled`, остальные отказы копируют ссылку.
- Цвет значков системных панелей: `src/lib/native/system-bars.ts` (встроенный в Capacitor 8 плагин SystemBars). На тёмном экране классической прогулки значки светлые.
- Ссылки, кнопка «Назад», заставка: `src/features/native/native-shell.tsx` (смонтирован в `src/app/layout.tsx`).
  - Ссылки `https://otgolosok.online/place/<тип>/<номер>`, `/`, `/?place=…`, `/?job=…`, `/walk?share=…` открываются внутри приложения (`src/features/native/app-links.ts`). Место на открытой карте меняет только адрес через `history.pushState`. Если идёт прогулка, переход на другую страницу сначала спрашивает подтверждение.
  - С установленным плагином App Android сам «Назад» не обрабатывает: приложение листает историю страницы, а на первой странице сворачивается (`minimizeApp`, чтобы не обрывать звук).
- Геолокация остаётся веб-API. `BridgeWebChromeClient` Capacitor сам запрашивает системное разрешение `ACCESS_FINE/COARSE_LOCATION`, когда страница вызывает `navigator.geolocation`. Тексты про запрет доступа в приложении говорят о настройках телефона, а не браузера.

## Сборка на Windows

Нужны Android Studio и Android SDK. Mac не нужен. Gradle 8.14 из шаблона Capacitor не запускается на JDK 25, который встроен в свежие Android Studio («Unsupported class file major version 69»). Нужен JDK 21, например Eclipse Temurin 21: в Android Studio — Settings → Build Tools → Gradle → Gradle JDK, в консоли — `JAVA_HOME`.

```bash
pnpm install
pnpm mobile:sync      # копирует конфигурацию и плагины в mobile/android
pnpm mobile:android   # открывает проект в Android Studio
```

Отладочную сборку запускают из Android Studio на телефоне с включённой «Отладкой по USB». Консоль WebView видна в Chrome на компьютере: `chrome://inspect`.

Иконки и заставку Android генерирует `node scripts/build-app-icons.mjs` из `src/app/icon.svg`. Ресурсы в `mobile/android/app/src/main/res` коммитятся.

## Подпись релиза

- Ключ загрузки создаётся один раз:
  ```bash
  keytool -genkeypair -v -keystore otgolosok-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
  ```
- Пути и пароли — в `mobile/android/keystore.properties` (в `.gitignore`) с ключами `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Вместо файла можно задать переменные `OTGOLOSOK_KEYSTORE_FILE`, `OTGOLOSOK_KEYSTORE_PASSWORD`, `OTGOLOSOK_KEY_ALIAS`, `OTGOLOSOK_KEY_PASSWORD`. Без них `assembleRelease`/`bundleRelease` падают с понятной ошибкой, неподписанный файл не собирается.
- `.jks` и пароли храните вне репозитория, с резервной копией в менеджере паролей. Потеря ключа блокирует обновления в RuStore, а в Google Play ключ загрузки сбрасывается только через поддержку.
- Версии: `versionName` — semver (`1.0.0`), `versionCode` — целое, растёт на 1 с каждой загрузкой в любой магазин (`mobile/android/app/build.gradle`).

## App Links

`AndroidManifest.xml` объявляет `autoVerify` для `https://otgolosok.online` с путями `/`, `/walk`, `/place/…`. Проверка заработает после того, как сайт начнёт отдавать `/.well-known/assetlinks.json` с SHA-256 всех ключей, которыми подписаны выпущенные сборки: ключ подписи Google Play (из Play Console), ключ загрузки и ключ сборки для RuStore. Этого файла пока нет: нужны отпечатки. Production nginx живёт во внешнем репозитории services; правку `location = /.well-known/assetlinks.json` с `application/json` применяет владелец.

## Проверка на устройстве (шаг 1.4 плана)

| Пункт | Статус |
| --- | --- |
| 1. Мост Capacitor на странице под нашей CSP | Эмулятор: мост есть, нарушений CSP нет, `getPlatform() = android`. |
| 2. Вход сохраняется после перезапуска, выход и POST с CSRF работают | Не проверено: нужен вход владельца аккаунта. |
| 3. Service Worker и офлайн-запуск; первый запуск без сети показывает `app-error.html` | Эмулятор: Service Worker управляет страницей, в режиме полёта открывается карта из кэша. Без сети и кэша открывается `app-error.html`, «Повторить» загружает сайт внутри приложения. |
| 4. Плитки карты, Метрика, аудио, картинки грузятся | Эмулятор: плитки, картинки, API и аудио грузятся. Метрику проверить не удалось: DNS рабочей сети не резолвит `mc.yandex.ru` и на компьютере. |
| 5. Звук при заблокированном экране; системные кнопки плеера | Эмулятор: история играет при выключенном экране. Уведомления с кнопками плеера нет, как и ожидалось (этап 2.4). Doze и долгую блокировку проверить на телефоне. |
| 6. Внешние ссылки открываются в браузере | Эмулятор: ссылки на другой домен (с `target="_blank"` и без) открываются в Chrome, приложение остаётся на своей странице. |
| 7. «Назад» листает историю и сворачивает приложение на первой странице | Эмулятор: `/history` → `/` → приложение сворачивается, процесс жив. Записи истории, созданные без жеста пользователя (переход из devtools), Chromium пропускает: `canGoBack` для них `false`. Проверять нажатиями. |
| 8. Отступы под вырез и системные панели | Эмулятор (WebView 145): `env(safe-area-inset-top)` = 24px, вёрстка не заезжает под панели. На WebView < 140 добавляются нативные отступы, не проверено. |
| 9. Разрешение на геолокацию: одно системное окно | Эмулятор: одно системное окно, после разрешения место определяется. |

Проверено 2026-10-05 на эмуляторе Pixel (Android 16, WebView 145.0.7632.218). Нужна ещё проверка на настоящем телефоне: вход, экран блокировки и Doze, прогулка по улице, «Поделиться» из карточки места, App Links.

Нативное окно «Поделиться» открывается, отмена возвращает ошибку «Share canceled», `app-share.ts` превращает её в `AbortError`. Карточку места на локальном сервере открыть не удалось (нет бэкенда), поэтому кнопку в карточке не проверяли.

Как проверять: собрать debug-сборку, открыть `chrome://inspect`, пройти пункты, записать сюда модель телефона, версию Android и версию WebView. Чтобы проверить код, ещё не выложенный на прод, приложение можно направить на локальный dev-сервер: `adb reverse tcp:3000 tcp:3000`, затем `OTGOLOSOK_APP_URL=http://localhost:3000 OTGOLOSOK_APP_DEV=1 pnpm mobile:sync` и сборка. Перед релизной сборкой снова выполнить `pnpm mobile:sync` без переменных.
