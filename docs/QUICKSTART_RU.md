# EventFlow — Быстрый запуск

## Вариант 1. Docker (рекомендуется)

Работает через Docker Compose на Windows, Linux и macOS. Не требует отдельной установки Node.js или PostgreSQL.

**Требуется:** Git, Docker Engine и Docker Compose v2.

```bash
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
docker compose -f compose.demo.yaml up -d --build
```

**Добавить демоданные:**

```bash
docker compose -f compose.demo.yaml run --rm seed
docker compose -f compose.demo.yaml run --rm demo-password
```

**Открыть:**

- Приложение: http://localhost:3000
- Организатор: http://localhost:3000/organizer
- Тестовая почта: http://localhost:3000/dev/mailbox
- Email: `demo.organizer@example.test`
- Пароль: результат команды `demo-password`

Демоданные: 6 мероприятий, регистрации, билеты, листы ожидания и статистика Check-in.

**Остановить:**

```bash
docker compose -f compose.demo.yaml down
```

Данные сохраняются. Для полного удаления демоданных используйте `down -v` (необратимо).

## Вариант 2. Без Docker

Требуется Node.js 24, pnpm 12.11.2 и PostgreSQL 18.

После настройки PostgreSQL и `.env` по основному [README](../README.md):

```bash
corepack enable
pnpm install
pnpm migrate
pnpm seed:demo
```

Запустите в трёх терминалах:

```bash
pnpm dev:web
pnpm dev:worker
pnpm dev:client
```

Откройте http://localhost:5173/organizer.

## Если возникли проблемы

```bash
docker compose -f compose.demo.yaml ps
docker compose -f compose.demo.yaml logs --tail=80
```

Docker-demo проверен в Ubuntu GitHub Actions. Windows и macOS отдельно не тестировались.
