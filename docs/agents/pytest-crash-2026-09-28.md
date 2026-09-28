# Сбой pytest на macOS — 28.09.2026

При проверке документации TLS команда `pnpm check` прошла ESLint, TypeScript, 381 тест Vitest, 440 тестов Node, Ruff и Pyright. Затем `uv run pytest -q` завершилась с кодом 139 без вывода. Повторный запуск с `-X faulthandler` показал segmentation fault при импорте `readline` из `_pytest/capture.py` до сбора тестов. Запуск с `-s` и отключённой автоматической загрузкой плагинов дал тот же код. В локальной `.venv` использовался Python 3.12.2; отдельный `import readline` тоже падал. `pnpm build` отдельно прошёл.

Окружение пересоздано командой `uv sync --python /Users/fenix007/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12 --frozen` на Python 3.12.12. После этого `uv run pytest -q` прошла: 19 тестов и 12 подтестов. Причина была в старом локальном интерпретаторе, а не в изменении Traefik или документации.
