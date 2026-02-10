.PHONY: help install dev build start test lint clean docker-up docker-down docker-logs setup

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Complete project setup (Docker + DB + Seed)
	@bash setup.sh

install: ## Install dependencies
	npm install

dev: ## Start development server
	npm run dev

build: ## Build for production
	npm run build

start: ## Start production server
	npm start

test: ## Run tests
	npm test

test-coverage: ## Run tests with coverage
	npm run test:coverage

lint: ## Lint code
	npm run lint

clean: ## Clean build artifacts and dependencies
	rm -rf dist node_modules coverage

docker-up: ## Start Docker services
	docker-compose up -d

docker-down: ## Stop Docker services
	docker-compose down

docker-clean: ## Stop and remove all Docker data
	docker-compose down -v

docker-logs: ## View Docker logs
	docker-compose logs -f

prisma-generate: ## Generate Prisma Client
	npm run prisma:generate

prisma-migrate: ## Run database migrations
	npm run prisma:migrate

prisma-deploy: ## Deploy migrations (production)
	npm run prisma:deploy

prisma-seed: ## Seed database
	npm run prisma:seed

prisma-studio: ## Open Prisma Studio
	npm run prisma:studio

prod-build: ## Build production Docker image
	docker-compose -f docker-compose.prod.yml build

prod-up: ## Start production environment
	docker-compose -f docker-compose.prod.yml up -d

prod-down: ## Stop production environment
	docker-compose -f docker-compose.prod.yml down

prod-logs: ## View production logs
	docker-compose -f docker-compose.prod.yml logs -f app
