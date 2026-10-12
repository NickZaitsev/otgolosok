# Четвёртая копия голоса «Отголосок2»

12 октября 2026 года четвёртый ключ в локальном `.env` проверен через `GET /v1/voices`: аккаунт отвечал, но голоса «Отголосок2» в нём не было. У первых трёх аккаунтов голос имел разные ID, но один исходный файл `otgolosok-production-3m58s.mp3` размером 1 901 229 байт в метаданных ElevenLabs.

Образец исходного голоса `9ivxhQ6xIsHd6R3Xc635` получен через `GET /v1/voices/{voice_id}/samples/{sample_id}/audio` и передан четвёртому аккаунту через `POST /v1/voices/add`. API вернул новый ID `TlRKEpAiY3799BTUYfvL`, `requires_verification: false`. Повторный `GET /v1/voices/{voice_id}` подтвердил имя «Отголосок2», категорию `cloned`, русский язык и прикреплённый образец. Скачанный через API образец имел 5 702 679 байт и SHA-256 `65aae5d9807ae678441c9485202e900401908ee3dfee5fda87603c89f65b900d`; это размер выданного API аудио, отличный от размера исходного файла в метаданных.

В локальном, игнорируемом Git `.env` теперь явно задан основной `ELEVENLABS_VOICE_ID=9ivxhQ6xIsHd6R3Xc635` и привязки резервных ключей к ID `JVYtLnrrrMG4dcGbtdAw`, `8Hp7MfQf2HGTKtrxXvVj`, `TlRKEpAiY3799BTUYfvL` в `ELEVENLABS_API_KEYS`. Ключи в документацию не внесены. Production-конфигурация не менялась; для работы четвёртого ключа на сервере нужна такая же привязка его ID. Платный синтез для слуховой проверки копии не запускался.

Согласно [документации ElevenLabs](https://elevenlabs.io/docs/help-center/product/voices/my-voices/who-has-access-to-my-voices), Instant Voice Clone нельзя расшарить между отдельными аккаунтами; каждая копия создаётся из образца. [API создания клона](https://elevenlabs.io/docs/api-reference/voices/ivc/create) возвращает отдельный ID для нового аккаунта.
