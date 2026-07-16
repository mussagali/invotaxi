.PHONY: up down test lint migrate shell

up:
	docker compose up -d --build

down:
	docker compose down

test:
	pytest -x -q

lint:
	ruff check .
	mypy app

migrate:
	docker compose exec api alembic upgrade head

shell:
	docker compose exec api python
