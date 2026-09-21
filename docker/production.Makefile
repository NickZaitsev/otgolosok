SHELL := /bin/sh
.DEFAULT_GOAL := help

GENERATOR_CONTAINER ?= otgolosok-generator-generator-1
shell_quote = '$(subst ','"'"',$(1))'

.PHONY: help admin-create admin-create-prod

help: ## Показать команды production-сервера
	@awk 'BEGIN {FS = ":.*## "; print "Отголосок: production\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

admin-create: admin-create-prod ## Создать редактора; EMAIL=ваш@email.ru

admin-create-prod: ## Создать редактора в работающем контейнере; EMAIL=ваш@email.ru
	@test -n $(call shell_quote,$(EMAIL)) || { printf '%s\n' 'Укажите EMAIL: make admin-create-prod EMAIL=ваш@email.ru' >&2; exit 1; }
	@docker exec -it -- $(call shell_quote,$(GENERATOR_CONTAINER)) node /app/editor-account.mjs $(call shell_quote,$(EMAIL)) /data/auth.sqlite
