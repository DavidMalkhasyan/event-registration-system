# EventFlow — быстрый запуск демо (Docker)

Нужны Git и Docker Compose v2. Демо работает только локально (`localhost`), на сервере его запускать нельзя.

## Две команды

```bash
git clone https://github.com/DavidMalkhasyan/event-registration-system.git && cd event-registration-system
docker compose -f compose.demo.yaml up -d --build
```

Всё настраивается автоматически: база, миграции, организация, оба аккаунта, 6 мероприятий с регистрациями, билетами, листами ожидания и check-in. Первый запуск занимает несколько минут. Затем покажите данные для входа:

```bash
docker compose -f compose.demo.yaml run --rm demo-access
```

## Ссылки и аккаунты

| Роль        | Ссылка                          | Email                         |
| ----------- | ------------------------------- | ----------------------------- |
| Организатор | http://localhost:3000/organizer | `demo.organizer@example.test` |
| Super Admin | http://localhost:3000/admin     | `demo.admin@example.test`     |

- Пароли случайные, создаются при первом запуске и хранятся только в Docker-томе; их показывает `demo-access`.
- Super Admin входит с паролем и кодом TOTP, второй фактор уже подключён. `demo-access` печатает текущий 6-значный код (действует до 30 с, каждый код работает один раз; для нового запустите команду снова). Можно добавить показанный TOTP-ключ в приложение-аутентификатор.
- Приложение: http://localhost:3000. Тестовая почта: http://localhost:3000/dev/mailbox.

## Остановка и сброс

```bash
docker compose -f compose.demo.yaml down       # остановить; данные и пароли сохраняются
docker compose -f compose.demo.yaml down -v    # удалить всё (необратимо), следующий up создаст всё заново
```

Проблемы: `docker compose -f compose.demo.yaml logs --tail=80`. Установка без Docker: [README](../README.md).
