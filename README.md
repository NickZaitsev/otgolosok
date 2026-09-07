This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Docker Compose

Нужны Docker Engine / Docker Desktop с Compose v2, доступ в интернет для загрузки
образов, npm-зависимостей и карты. Node.js и FFmpeg на хосте не требуются.
Полный стек запускается одной командой, без `.env` и без дополнительных профилей:

```bash
docker compose up -d --build
```

Открыть **http://localhost:8080**. Compose автоматически поднимает nginx со
статическим Next.js export, Node.js backend с FFmpeg и Valhalla для пеших маршрутов.
Только nginx публикует порт, по умолчанию на `127.0.0.1`. Backend и Valhalla
доступны только внутри Docker-сети; `WALK_ROUTER_URL=http://valhalla:8002/route`.
Nginx обслуживает `/create`, `/admin`, `/walk` без расширения `.html` и передаёт
`/api/` backend с Origin, Authorization и Range. API не кешируется.

### Настройка

При необходимости создайте локальный `.env` по образцу `.env.example` до запуска.
Он исключён из Git и frontend build context. AI-ключи передаются только backend
во время запуска, не через build args и не в клиент. Не публикуйте вывод
`docker compose config`: он раскрывает значения; для проверки есть
`docker compose config --quiet`.

- `HTTP_PORT` и `BIND_ADDRESS` меняют опубликованный порт и интерфейс.
- `APP_ORIGIN` должен точно совпадать с адресом в браузере, без завершающего `/`.
  При смене порта обновите и его; `localhost` и `127.0.0.1` считаются разными origin.
- `OPENAI_API_KEY` и `OPENAI_BASE_URL` (HTTPS API с Responses и audio/speech)
  включают платную генерацию. Без них сайт запускается, но генерация отключена.
- `ADMIN_TOKEN` включает редакторский доступ; используйте случайный ключ минимум
  32 байта, например результат `openssl rand -hex 32`. Без ключа доступ закрыт.
- `MAX_DAILY_JOBS`, `STORY_MODEL`, `WRITER_MODEL` настраивают генератор.

Для внешнего доступа используйте HTTPS reverse proxy перед nginx и задайте
`APP_ORIGIN=https://ваш-домен`. На удалённых устройствах HTTPS нужен для GPS/PWA.
Не открывайте backend или Valhalla наружу. Если reverse proxy на хосте, оставьте
loopback bind; `BIND_ADDRESS=0.0.0.0` открывает HTTP на всех интерфейсах и требует
осознанной настройки firewall. После изменения `.env` повторите `docker compose up -d`.

### Первый Запуск

Valhalla использует поддерживаемый upstream-образ
[`ghcr.io/valhalla/valhalla-scripted:latest`](https://github.com/valhalla/valhalla/blob/master/docker/README.md):
прежний `nilsnolde/docker-valhalla` архивирован и направляет туда.
Тег `latest` изменяемый; для воспроизводимого production-деплоя закрепите проверенный
digest образа. По умолчанию автоматически скачивается
[Moscow.osm.pbf от BBBike](https://download.bbbike.org/osm/bbbike/Moscow/Moscow.osm.pbf)
(около 81 MiB на момент проверки), затем строятся routing tiles с поддержкой
`pedestrian`. Покрытие ограничено этим extract, не всей Россией.

Выделите Docker несколько GiB RAM и несколько GiB свободного диска с запасом:
распакованные графы и временные файлы значительно больше PBF. Первый запуск может
занять минуты или значительно дольше на слабом хосте; для больших extract это
могут быть часы. `VALHALLA_THREADS=2` ограничивает параллелизм сборки и сервиса.
Сайт не ждёт построения графа: backend зависит от запуска контейнера, а не его
готовности. До готовности Valhalla запросы построения маршрута могут возвращать
ошибки; повторите их после статуса `healthy`. Готовность проверяется через
документированный `/status`, начало сборки допускается в течение часа до
отметки `unhealthy`; эта отметка сама по себе не останавливает сборку.

```bash
docker compose ps
docker compose logs -f --tail=100 valhalla
docker compose exec valhalla curl --fail http://127.0.0.1:8002/status
curl --fail http://localhost:8080/api/story-service
```

`use_tiles_ignore_pbf=True` переиспользует сохранённый tar графа при следующих
стартах. `VALHALLA_TILE_URL` можно изменить до первой сборки; с готовым томом одна
смена URL не обновит карту. Обновление PBF/принудительную пересборку выполняйте
отдельно по upstream-инструкции после резервного копирования. Геокодер, Overpass
и AI остаются внешними сервисами: локальная Valhalla не делает весь стек офлайн.

### Данные И Остановка

Именованные тома `backend_data` (`/data`, принадлежит `node`) и `valhalla_data`
(`/custom_files`) сохраняют SQLite, созданные аудиофайлы и routing tiles.
Обычные пересборки и остановка не удаляют их:

```bash
docker compose down
```

**Не добавляйте `-v`**: это удалит оба тома вместе с историями и графом.
Для файлового backup остановите backend (`docker compose stop backend`) и
скопируйте весь его том, включая SQLite WAL и аудио; после копирования запустите
`docker compose start backend`. Valhalla-том резервируйте вне сборки, лучше с
остановленным сервисом. Храните резервные копии отдельно от Docker-хоста.
Копирование только живого `jobs.sqlite` не является корректным backup.

Эквивалентные команды Make: `make docker-up`, `make docker-down`,
`make docker-logs`, `make docker-ps`, `make docker-config`.
