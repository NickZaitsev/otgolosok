#!/bin/sh
# Утренняя проверка ночных заданий через Codex (make morning-check).
# Отчёт — последнее сообщение Codex в $MORNING_CHECK_LOGS/<время>.md, полный журнал рядом в .log.
# Модель иногда отвечает «нет доступа к терминалу», не вызвав ни одной команды: такой прогон
# не считается проверкой — он повторяется, а после последней попытки завершается ошибкой.
set -u

CODEX="${CODEX:-codex}"
CODEX_PROFILE="${CODEX_PROFILE:-coding}"
LOGS="${MORNING_CHECK_LOGS:-.logs/morning-check}"
ATTEMPTS="${MORNING_CHECK_ATTEMPTS:-2}"
PROMPT="ops/morning-check.md"

[ -f .env.ops ] && grep -q '^VPS=.' .env.ops || {
  echo "Укажите VPS=user@host в .env.ops" >&2
  exit 1
}
mkdir -p "$LOGS" || exit 1

# Under an Orca automation the outer agent runs commands with Codex's "core" environment, without the
# key the coding profile authenticates with; it is exported in the owner's interactive zsh.
if [ -z "${OPENAI_API_KEY:-}" ]; then
  OPENAI_API_KEY="$(zsh -ic 'printf "\n__morning_check_key__%s\n" "${OPENAI_API_KEY:-}"' 2>/dev/null |
    sed -n 's/^__morning_check_key__//p' | tail -n 1)"
  export OPENAI_API_KEY
fi
[ -n "$OPENAI_API_KEY" ] || {
  echo "OPENAI_API_KEY не задан ни в окружении, ни в интерактивном zsh: Codex не сможет авторизоваться" >&2
  exit 1
}

attempt=1
while :; do
  stamp="$(date +%Y-%m-%dT%H%M%S)"
  report="$LOGS/$stamp.md"
  log="$LOGS/$stamp.log"
  "$CODEX" exec --profile "$CODEX_PROFILE" --sandbox danger-full-access \
    --cd "$(pwd)" --output-last-message "$report" - <"$PROMPT" >"$log" 2>&1
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "Codex завершился с кодом $status, журнал: $log" >&2
    exit "$status"
  fi
  # Каждая команда Codex начинается в журнале строкой «exec».
  if grep -q '^exec$' "$log"; then
    cat "$report"
    exit 0
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "Codex не выполнил ни одной команды за $ATTEMPTS попыток, проверка не состоялась. Журнал: $log" >&2
    exit 2
  fi
  echo "Codex не выполнил ни одной команды (попытка $attempt), повторяю" >&2
  attempt=$((attempt + 1))
done
