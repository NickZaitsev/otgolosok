# Промопрогулки по Казани: K03 и K04

Вторая очередь [плана Казани](../../docs/agents/plans/2026-10-12-kazan-center-and-promo-walks.md). Тексты написаны заново по русской Википедии и страницам архитектурных объектов на сайте музея-заповедника «Казанский Кремль». Купленный тур IZI «Казанский кремль. Камчатские экспедиции» использовался только для выбора сюжетов: Тайницкая башня, Дворцовая церковь, Губернаторский дворец, гауптвахта.

## Состояние 13 октября 2026

- 28 текстов опубликованы на production без звука (`publication.json`, бэкап до операции — на сервере в `ops-backups/kazan-center-k03-k04-2026-10-13`).
- Озвучка ElevenLabs v4 не запускалась: 28 записей, 26 711 символов ждут подтверждения.
- Фото: 28 снимков Wikimedia Commons в редакционном каталоге, для 13 точек файл подобран вручную после просмотра контактного листа.
- Аудит Codex (`audit-response.md`): 6 блокирующих замечаний исправлены (дата теории Бутлерова — 1861, расположение старого театра, «крупнейшая площадь», оговорка о географическом центре, полные имена архитекторов и поэтов); необязательные учтены, кроме переименования источников.
- Дворец земледельцев написан, но отложен до следующей очереди: из K04 к нему слишком длинный крюк (`RESERVE` в рабочем скрипте).

| Прогулка | Метро | Точек | Слов | Оценка аудио | Пешком |
|---|---|---:|---:|---|---|
| K03. Кремль и университет | «Кремлёвская» → «Площадь Тукая» | 14 | 1909 | 15.0–18.2 мин | 5.62 км / 70 мин |
| K04. Сады и площади: от Ленинского сада до «Эрмитажа» | «Площадь Тукая» → «Площадь Тукая», круговая | 14 | 1956 | 15.4–18.6 мин | 6.17 км / 77 мин |

Оценка аудио — по темпу записей v4 выпуска K01/K02 (105–127 слов в минуту); порог 15 минут подтверждается только измерением готовых MP3. Отрезки маршрутов — в `routes.json` (Valhalla, граф Москва + Казань).

## K03. Кремль и университет

| № | Точка | Слов | Фото (Commons) |
|---:|---|---:|---|
| 1 | [Тайницкая башня](https://otgolosok.online/?place=osm:relation:15958807) | 159 | Taynitskaya tower of Kazan Kremlin (2).jpg — CC BY 3.0 |
| 2 | [Дворцовая церковь](https://otgolosok.online/?place=osm:node:12213924368) | 139 | Descent Holy Spirit church, Kazan Kremlin (2022-06-01) 01.jpg — CC BY-SA 4.0 |
| 3 | [Ханский двор и Губернаторский дворец](https://otgolosok.online/?place=osm:way:659039029) | 142 | Kazan Kremlin Presidential Palace 08-2016.jpg — FAL |
| 4 | [Присутственные места](https://otgolosok.online/?place=osm:relation:6303321) | 163 | Казань, Кремль, присутственные места.jpg — CC BY-SA 4.0 |
| 5 | [Юнкерское училище](https://otgolosok.online/?place=osm:relation:6303303) | 132 | Казань, Кремль, юнкерское училище.jpg — CC BY-SA 4.0 |
| 6 | [Манеж](https://otgolosok.online/?place=osm:relation:6303322) | 113 | Манеж. Кремль, Казань.JPG — CC BY-SA 4.0 |
| 7 | [Гауптвахта](https://otgolosok.online/?place=osm:way:479025579) | 125 | Kazan Kremlin Guardhouse 2024-07-13 1437.jpg — CC BY-SA 3.0 |
| 8 | [Гостинодворская церковь](https://otgolosok.online/?place=osm:way:90155416) | 122 | Kazan St Nicholas Gostinodvorskaya Сhurch 2024-07-14 1739.jpg — CC BY-SA 3.0 |
| 9 | [Главное здание Казанского университета](https://otgolosok.online/?place=osm:relation:14238623) | 132 | Kazan Federal University building 08-2016.jpg — FAL |
| 10 | [Памятник студенту Володе Ульянову](https://otgolosok.online/?place=osm:node:966489790) | 131 | Казань. Памятник студенту Володе Ульянову (Ленину) перед главным зданием университета (1).JPG — CC BY-SA 4.0 |
| 11 | [Астрономическая обсерватория](https://otgolosok.online/?place=osm:way:91856512) | 135 | Astronomy Observatory of Kazan State University 2 wiki.jpg — CC BY 3.0 |
| 12 | [Химический институт имени Бутлерова](https://otgolosok.online/?place=osm:way:83073570) | 134 | ХИ.jpg — CC BY-SA 4.0 |
| 13 | [Памятник Лобачевскому](https://otgolosok.online/?place=osm:node:1012203858) | 145 | Lobachevsky monument, Kazan (2024-04-17) 03.jpg — CC BY-SA 4.0 |
| 14 | [Дом Ушковой](https://otgolosok.online/?place=osm:way:87009792) | 137 | Kazan new ac build and lib.JPG — CC BY-SA 3.0 |

## K04. Сады и площади: от Ленинского сада до «Эрмитажа»

| № | Точка | Слов | Фото (Commons) |
|---:|---|---:|---|
| 1 | [Ленинский сад](https://otgolosok.online/?place=osm:way:75658841) | 142 | Leninskiy garden, Kazan (2021-05-15) 02.jpg — CC BY-SA 4.0 |
| 2 | [Чёрное озеро](https://otgolosok.online/?place=osm:way:40371211) | 154 | Black Lake, Kazan.JPG — CC BY-SA 3.0 |
| 3 | [Церковь Святой Екатерины](https://otgolosok.online/?place=osm:relation:18117393) | 125 | Kazan luther.JPG — Public domain |
| 4 | [Площадь Свободы и памятник Ленину](https://otgolosok.online/?place=osm:node:892767318) | 124 | Lenin monument, Freedom Square, Kazan (2024-04-22) 01.jpg — CC BY-SA 4.0 |
| 5 | [Театр оперы и балета имени Мусы Джалиля](https://otgolosok.online/?place=osm:way:75658002) | 149 | Театр оперы и балета. Казань.JPG — CC BY-SA 3.0 |
| 6 | [Фуксовский сад](https://otgolosok.online/?place=osm:way:82899027) | 156 | Fuks Garden4.JPG — CC BY-SA 3.0 |
| 7 | [Дом Кекина](https://otgolosok.online/?place=osm:way:103455126) | 127 | Kazan Kekin Building 08-2016.jpg — FAL |
| 8 | [Музей Горького и Шаляпина](https://otgolosok.online/?place=osm:node:2951266146) | 141 | Ттарстан. Казань. Дом, в котором в 1886 - 1887 гг. жил и работал пекарем Горький Алексей Максимович.jpg — CC BY-SA 4.0 |
| 9 | [Музей-квартира Мусы Джалиля](https://otgolosok.online/?place=osm:node:1230992846) | 140 | Казань, улица Горького, 17.jpg — CC BY-SA 4.0 |
| 10 | [Особняк Сандецкого](https://otgolosok.online/?place=osm:way:277633796) | 134 | Гл здание ГМИИ РТ.JPG — Public domain |
| 11 | [Музей Боратынского](https://otgolosok.online/?place=osm:node:4850362994) | 130 | Kazan 20180811 050534.jpg — CC BY-SA 4.0 |
| 12 | [Лядской сад](https://otgolosok.online/?place=osm:way:81512367) | 144 | "Ljadskoj" garden - Лядской садик - panoramio.jpg — CC BY-SA 3.0 |
| 13 | [Памятник Державину](https://otgolosok.online/?place=osm:node:2288083505) | 146 | Derzhavin monument, Kazan (2021-07-06) 02.jpg — CC BY-SA 4.0 |
| 14 | [Сад «Эрмитаж»](https://otgolosok.online/?place=osm:way:82176829) | 144 | Hermitage garden, Kazan (2024-06-12) 03.jpg — CC BY-SA 4.0 |
