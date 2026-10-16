# EventFlow — быстрый запуск

**Рекомендуемый способ: Docker.** Требуются Git, Docker Desktop (Windows/macOS) или Docker Engine (Linux) с Compose v2. Интернет нужен при первой сборке.

## 1. Запуск демоверсии

```bash
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
docker compose -f compose.demo.yaml up -d --build
```

PostgreSQL 18, миграции, две учётные записи, одобренная организация и 6 мероприятий с участниками, билетами, очередями и check-in создаются автоматически.

## 2. Доступ к демоверсии

| Роль | Email | Пароль | Вход |
| --- | --- | --- | --- |
| Организатор | `demo.organizer@example.test` | `DemoOrganizer2026!` | http://localhost:3000/organizer |
| Super Admin | `demo.admin@example.test` | `DemoAdmin2026!` | http://localhost:3000/admin |

**Сайт:** http://localhost:3000 · **Тестовые письма:** http://localhost:3000/dev/mailbox

Это **только локальные демоаккаунты** в `DEMO_MODE=true`. В production такой режим запрещён, а для Super Admin обязателен TOTP. Пароли из таблицы не подходят для обычного запуска без Docker.

## 3. Проверка, остановка и сброс

```bash
docker compose -f compose.demo.yaml ps
docker compose -f compose.demo.yaml logs --tail=80
docker compose -f compose.demo.yaml down       # остановить, данные останутся
```

Если раньше уже запускали демо со старыми паролями, сначала выполните `docker compose -f compose.demo.yaml down -v`, затем повторите `up -d --build`. **`down -v` безвозвратно удаляет базу, изображения, письма и локальные секреты.**

## 4. Без Docker (для разработки)

Требуются **Node.js 24**, **pnpm 12.11.2**, **PostgreSQL 18** и `psql`. На Windows используйте Git Bash для команд ниже; Linux/macOS — Bash/zsh. PostgreSQL должен быть запущен локально.

```bash
corepack enable
pnpm install
psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 \
  -v owner_password='<owner-password>' -v runtime_password='<runtime-password>' \
  -f scripts/provision-local-db.sql
cp .env.example .env
```

В `.env` укажите придуманные пароли в четырёх строках `*DATABASE_URL` и замените `CSRF_SECRET`, `PRESESSION_SECRET`, `RATE_LIMIT_SECRET`, `PREVIEW_SECRET` случайными строками от 32 символов. Затем:

```bash
pnpm migrate
pnpm seed:demo     # опционально: тестовые данные; пароли новых аккаунтов показываются при создании
```

В **трёх отдельных терминалах** запустите `pnpm dev:web`, `pnpm dev:worker` и `pnpm dev:client`. Сайт: http://localhost:5173/organizer, почта: http://localhost:5173/dev/mailbox.

**Проверка:** Docker-demo и вход двух ролей проверены в Ubuntu CI и изолированном Docker-стеке; Windows/macOS отдельно не проверялись. Реальная отправка писем (Resend) не проверялась.
