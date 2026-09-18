# Запуск OSM-заданий при работающих Otgolosok и just-tts

Все команды ниже — на сервере Otgolosok в Linux shell. Понадобятся checkout
развёрнутой версии приложения и готовый JSON каталога. Локальный снимок
`C:\00_projects\otgolosok\backend\data\osm-attractions.json` содержит 6 107
объектов; он не включён в Git или Docker-образ. Перенесите его на сервер,
например в `/srv/sites/otgolosok.softmg.tech/osm-attractions.json`.

## 1. Убедиться, что backend настроен

В production окружении backend должны быть `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
`CONTENT_AUTO_APPROVE=true`, `LOCAL_TTS_TRANSPORT=http`,
`LOCAL_TTS_ENGINE=f5`, `TTS_API_URL` и `TTS_API_TOKEN`. Для F5 нужны также
`F5_MODEL_SHA256`, `F5_REFERENCE_ID`, `F5_CONFIG_SHA256` и, если используется,
`F5_REFERENCE_SHA256`. Последние значения берутся из `GET /v1/profiles` сервиса
just-tts. Если меняли `.generator.env`, пересоздайте backend, чтобы новые
значения попали в процесс. Для Silero задайте `LOCAL_TTS_ENGINE=silero` и
согласуйте checksum модели и голос. Не выводите токены при проверке окружения.

## 2. Найти настоящую production-базу

```bash
cd /srv/sites/otgolosok.softmg.tech
docker compose -f generator-compose.yml ps
docker inspect "$(docker compose -f generator-compose.yml ps -q backend)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}} {{.Source}}{{end}}{{end}}'
```

Вывод для `/data` будет, например, `bind /srv/.../generator-data` или
`volume /var/lib/docker/volumes/.../_data`. Укажите **полученный** путь как
`DATA_DIR`, убедившись, что shell-пользователь имеет к нему доступ. Если
Docker named volume недоступен с хоста, запускайте следующие команды в
одноразовом контейнере с тем же томом и исходниками приложения. Текущий
backend-образ не содержит скриптов `scripts/`. Не создавайте пустую БД по
другому пути. Перед импортом сохраните резервную копию базы и аудио.

## 3. Импортировать каталог и создать первую партию

Из checkout версии production с установленными зависимостями и Node.js >=24.20:

```bash
cd /ПУТЬ/К/CHECKOUT/otgolosok
export DATA_DIR=/ПУТЬ/ИЗ/docker-inspect
export LOCAL_TTS_ENGINE=f5

# Только если каталог ещё не загружен в production:
node scripts/load-osm-catalog.mjs \
  /srv/sites/otgolosok.softmg.tech/osm-attractions.json --complete

# 50 заданий text-and-audio; партия создаётся на паузе:
node scripts/create-osm-batch.mjs --next --limit 50
```

`--complete` означает, что JSON содержит полный снимок: отсутствующие в нём
объекты архивируются. Используйте этот флаг только для проверенного полного
снимка после резервного копирования. Если каталог уже загружен, импорт
пропустите. Скрипт создания партии читает `LOCAL_TTS_ENGINE` из shell: задайте
тот же движок, что работает в backend (`silero` вместо `f5` при Silero).

В выводе скрипта будет `id` партии. Откройте
`https://otgolosok.softmg.tech/admin?section=content`, найдите её и нажмите
**«Продолжить»**. Тогда запустится платная генерация текста. Дождитесь
результата и проверьте текст и MP3 на сайте.

## 4. Создать остальные задания

```bash
node scripts/create-osm-batch.mjs --next --limit 5000
node scripts/create-osm-batch.mjs --next --limit 5000
```

Обе новые партии тоже создаются **на паузе**: продолжите их в админке.
`--next` пропускает объекты, для которых уже есть текстовое задание `story-v1`.
Когда свободных объектов не будет, скрипт напишет
`All places in this snapshot already have a text job`. При
`CONTENT_AUTO_APPROVE=true` новые тексты, успешно прошедшие автоматическую
проверку, публикуются и ставятся в очередь just-tts. Результаты
`review_required`, `insufficient_evidence` и `failed` нужно разбирать и
повторять отдельно; флаг не публикует старые черновики.

Проверка опубликованных объектов:

```bash
curl -fsS 'https://otgolosok.softmg.tech/api/content/places?status=ready&limit=10'
```

Если ответ 404 — проверьте production маршрутизацию `/api/content/*` к backend.
Если текст есть, а MP3 нет — проверьте профиль партии и аудиозадания в админке,
а также доступность just-tts из backend. В режиме `just-tts serve` URL сайта на
сервере озвучки не нужен.
