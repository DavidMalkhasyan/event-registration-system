# EventFlow — быстрый запуск демо (Docker)

Нужны только Git и Docker Compose v2. Демо работает локально (`localhost`), на сервере его запускать нельзя.

## 1. Запуск и демоданные

```bash
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
docker compose -f compose.demo.yaml up -d --build
docker compose -f compose.demo.yaml run --rm seed
```

`seed` создаёт организатора, Super Admin и 6 мероприятий (регистрации, билеты, листы ожидания, check-in). Команду можно повторять: дубликатов не будет.

## 2. Учётные данные

Пароли случайные, создаются при первом запуске и хранятся только в Docker-томе. Показать:

```bash
docker compose -f compose.demo.yaml run --rm demo-password
```

| Роль        | Адрес                           | Email                         |
| ----------- | ------------------------------- | ----------------------------- |
| Организатор | http://localhost:3000/organizer | `demo.organizer@example.test` |
| Super Admin | http://localhost:3000/admin     | `demo.admin@example.test`     |

Почта в демо не уходит наружу: письма лежат в http://localhost:3000/dev/mailbox.

## 3. Второй фактор Super Admin (один раз)

Как в production, Super Admin входит с паролем и кодом из приложения-аутентификатора (Google Authenticator, Aegis, 1Password и т. п.). Без настройки вход возвращает «second factor required».

```bash
docker compose -f compose.demo.yaml run --rm admin-totp
```

Команда покажет ссылку `otpauth://…` и ключ. Добавьте ключ в приложение (вручную или через QR-генератор ссылки), введите 6-значный код в консоли. Затем войдите на `/admin`: email, пароль и текущий код. Повторный запуск команды заменяет второй фактор новым.

## 4. Остановка и сброс

```bash
docker compose -f compose.demo.yaml down       # остановить, данные и пароли сохраняются
docker compose -f compose.demo.yaml down -v    # удалить всё: данные, пароли, ключ TOTP (необратимо)
```

После `down -v` повторите шаги 1–3: будут новые пароли и новый второй фактор.

## Если что-то не работает

```bash
docker compose -f compose.demo.yaml ps
docker compose -f compose.demo.yaml logs --tail=80
```

Установка без Docker (Node.js, PostgreSQL, pnpm): см. [README](../README.md).
