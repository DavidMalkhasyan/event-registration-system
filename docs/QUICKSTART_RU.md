# EventFlow — быстрый запуск демо (Docker)

Нужны Git и Docker Compose v2. Демо работает только локально (`localhost`), на сервере его запускать нельзя.

## Запуск

```bash
git clone https://github.com/DavidMalkhasyan/event-registration-system.git && cd event-registration-system
docker compose -f compose.demo.yaml up -d --build
```

Всё настраивается автоматически: база, миграции, организация, оба аккаунта, 6 мероприятий с регистрациями, билетами, листами ожидания и check-in. Первый запуск занимает несколько минут.

## Доступ к демоверсии

| Роль        | Email                         | Пароль               | Ссылка для входа                |
| ----------- | ----------------------------- | -------------------- | ------------------------------- |
| Организатор | `demo.organizer@example.test` | `DemoOrganizer2026!` | http://localhost:3000/organizer |
| Super Admin | `demo.admin@example.test`     | `DemoAdmin2026!`     | http://localhost:3000/admin     |

- Super Admin входит только по email и паролю, без кода TOTP: так сделано лишь в локальном Docker-демо (`DEMO_MODE=true` в `compose.demo.yaml`). В production `DEMO_MODE` запрещён, а TOTP обязателен.
- Тестовая почта (письма приложения): http://localhost:3000/dev/mailbox. Приложение: http://localhost:3000.
- Если демо уже запускалось раньше (старые случайные пароли), выполните `docker compose -f compose.demo.yaml down -v` и запустите заново.

## Остановка и сброс

```bash
docker compose -f compose.demo.yaml down       # остановить; данные сохраняются
docker compose -f compose.demo.yaml down -v    # удалить всё (необратимо), следующий up создаст всё заново
```

Проблемы: `docker compose -f compose.demo.yaml logs --tail=80`. Установка без Docker: [README](../README.md).
