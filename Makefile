SHELL := /bin/sh

.DEFAULT_GOAL := help

PNPM ?= pnpm
DOCKER_COMPOSE ?= docker compose

.PHONY: help install dev dev-https replay build serve lint typecheck test check clean
.PHONY: docker-up docker-down docker-logs docker-ps docker-config

help: ## Показать доступные команды
	@awk 'BEGIN {FS = ":.*## "; printf "Отголосок\n\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Установить зависимости
	$(PNPM) install

dev: ## Запустить локальную разработку
	$(PNPM) dev

dev-https: ## Запустить dev-сервер по HTTPS для GPS и PWA
	$(PNPM) dev:https

replay: ## Запустить dev-сервер; открыть http://localhost:3000/?replay=clean
	@printf '%s\n' 'Replay: http://localhost:3000/?replay=clean'
	$(PNPM) dev

build: ## Собрать статический production export в out/
	$(PNPM) build

serve: build ## Собрать и локально раздать production export
	$(PNPM) start

lint: ## Проверить ESLint
	$(PNPM) lint

typecheck: ## Проверить TypeScript
	$(PNPM) typecheck

test: ## Запустить unit-тесты
	$(PNPM) test

check: lint typecheck test build ## Выполнить все проверки

clean: ## Удалить генерируемые каталоги Next.js
	rm -rf -- .next out

docker-up: ## Build and start the complete Docker stack
	$(DOCKER_COMPOSE) up -d --build

docker-down: ## Stop Docker stack, preserving data volumes
	$(DOCKER_COMPOSE) down

docker-logs: ## Follow Docker stack logs
	$(DOCKER_COMPOSE) logs -f --tail=100

docker-ps: ## Show Docker stack status and health
	$(DOCKER_COMPOSE) ps

docker-config: ## Validate Compose without printing credentials
	$(DOCKER_COMPOSE) config --quiet
