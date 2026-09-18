# Запуск всех OSM-достопримечательностей в production

Запуск использует F5 через уже настроенный сервер `just-tts`. Его URL, токен и
параметры профиля должны находиться в production-окружении backend. Не копируйте
их в команды или в Git.

## TL;DR

### 1. Передать каталог

С рабочей машины:

```bash
export PRODUCTION_SSH=<пользователь-и-хост-production>

scp backend/data/osm-attractions.json \
  "$PRODUCTION_SSH:/srv/sites/otgolosok/osm-attractions.json"
```

### 2. Импортировать каталог и запустить задания

На production-сервере из checkout текущей версии приложения:

```bash
export APP_ROOT=<путь-к-checkout-otgolosok>
export GENERATOR_ENV=<путь-к-generator.env>
export PRODUCTION_DATA=<путь-к-production-data>

cd "$APP_ROOT"

set -a
. "$GENERATOR_ENV"
set +a

export DATA_DIR="$PRODUCTION_DATA"
export LOCAL_TTS_ENGINE=f5
export LOCAL_TTS_TRANSPORT=http

node scripts/load-osm-catalog.mjs \
  /srv/sites/otgolosok/osm-attractions.json --complete
node scripts/create-osm-batch.mjs --next --limit 5000 --start
```

Этого достаточно для текущего снимка: в файле 6 107 объектов, но проверку
пригодности проходят 1 553. Все они попадут в одну запущенную партию. Остальные
4 554 объекта импортируются, но не отправляются модели, потому что имеющихся
OSM-данных недостаточно для надёжного определения конкретного объекта.

Команда с `--next` пропускает уже созданные задания. Её можно повторить после
прерванного запуска; дубликаты не появятся. Если в новом снимке подходящих
объектов станет больше 5 000, повторяйте последнюю команду, пока она не сообщит,
что свободных объектов не осталось.

### 3. Проверить результат

```bash
curl -fsS 'https://otgolosok.softmg.tech/api/content/places?status=ready&limit=10'
```

Ход выполнения и ошибки видны в разделе `content` production-админки.
`CONTENT_AUTO_APPROVE=true` публикует только материалы, прошедшие автоматическую
проверку. Статусы `review_required`, `insufficient_evidence` и `failed`
автоматически не публикуются.

## Что должно быть в `.generator.env`

Нужны `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `CONTENT_AUTO_APPROVE=true`,
`LOCAL_TTS_ENGINE=f5`, `LOCAL_TTS_TRANSPORT=http`, `TTS_API_URL`,
`TTS_API_TOKEN` и параметры профиля F5. Они уже должны быть настроены вместе с
сервером F5; в runbook их значения намеренно не приводятся.
