# Архив старых сборок сайта на production

12 октября 2026 года три каталога `dist-before-tekstilshchiki-*` перенесены
из `/srv/sites/otgolosok.softmg.tech/` в
`/srv/sites/otgolosok.softmg.tech/archives/static/`:

- `dist-before-tekstilshchiki-final-20261009`;
- `dist-before-tekstilshchiki-preview-20261009`;
- `dist-before-tekstilshchiki-realphoto-20261009`.

Это прежние статические сборки общим размером 253 МиБ. Содержимое и имена
сохранены, место на диске перенос не освободил. Текущий сайт использует
`dist`: именно этот каталог смонтирован в nginx. Перед переносом проверены
монтирования контейнеров и ссылки в конфигурации; перенос выполнен под
`.deploy.lock`.

После переноса `docker compose config --quiet` прошёл, главная страница и
`/api/content/map-cells` ответили HTTP 200 по HTTP/2. Если потребуется
откатить одну из этих старых сборок, её можно найти в `archives/static/`;
для освобождения 253 МиБ нужно будет отдельно принять решение об удалении.
