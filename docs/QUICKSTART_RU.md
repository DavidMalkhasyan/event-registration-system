# EventFlow: быстрый запуск

Два способа запустить приложение локально. **Способ A (Docker)** рекомендуется: нужен только Docker, ни Node.js, ни PostgreSQL ставить не надо. **Способ B** нужен для разработки.

> **Статус проверки.** Файл `compose.demo.yaml` и эта инструкция подготовлены на машине без Docker и без Node.js, поэтому запуск контейнеров на Windows, Linux и macOS **ещё не проверен автором**. Если шаг не сработал, пришлите вывод команды `docker compose -f compose.demo.yaml logs`.

## Способ A. Docker (рекомендуется)

Демо-стек (`compose.demo.yaml`) поднимает: PostgreSQL 18, миграции, веб-процесс (API и React-клиент на одном адресе), фоновый worker и «поддельную» почту (письма не отправляются, их можно читать в браузере). Домен, HTTPS и Resend не нужны.

- Приложение: **http://localhost:3000** (порт открыт только на `127.0.0.1`).
- PostgreSQL наружу не публикуется.
- Секреты (пароли БД, ключи) генерируются случайно при первом запуске и хранятся в Docker-томе `demo-secrets`, а не в Git.
- Данные хранятся в томах Docker: `pgdata` (база), `media` (изображения), `mailbox` (письма), `demo-secrets`.

### Установка Docker

**Windows 10/11.** Установите [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) с бэкендом WSL 2 (при установке оставьте включённой опцию «Use WSL 2»; при необходимости выполните в PowerShell от администратора `wsl --install` и перезагрузитесь). Запустите Docker Desktop и дождитесь статуса «Engine running». Команды ниже выполняются в PowerShell, Windows Terminal или Git Bash: они одинаковы.

**Linux.** Установите [Docker Engine](https://docs.docker.com/engine/install/) и плагин Compose v2 (`docker-compose-plugin`). Проверьте: `docker compose version`. Чтобы не писать `sudo`, добавьте себя в группу: `sudo usermod -aG docker $USER` (затем перелогиньтесь).

**macOS.** Установите [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) (Intel или Apple Silicon). Образы `node:24-bookworm-slim` и `postgres:18` многоархитектурные (в том числе ARM64), Rosetta не требуется.

Проверка: `docker --version` и `docker compose version` (нужен Compose v2).

### 1. Клонирование

```sh
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
git checkout dev
```

> Файл `compose.demo.yaml` находится в ветке `dev` (после слияния PR) или в ветке `feature/docker-demo`. Если его нет, выполните `git checkout feature/docker-demo`.

### 2. Подготовка конфигурации

Ничего вручную настраивать не нужно: при первом запуске служба `secrets-init` сама создаёт случайные секреты в томе `demo-secrets`. Файл `.env` для Docker-способа не используется.

### 3. Запуск контейнеров

```sh
docker compose -f compose.demo.yaml up -d --build
```

Первая сборка занимает несколько минут (скачиваются образы, собирается клиент и сервер). Дождитесь, пока `web` станет `healthy`:

```sh
docker compose -f compose.demo.yaml ps
```

Миграции применяются автоматически (служба `migrate` завершается со статусом `Exited (0)`: это нормально).

### 4. Демо-данные

Одна команда (запускается только явно, при старте стека не выполняется; повторный запуск ничего не дублирует):

```sh
docker compose -f compose.demo.yaml run --rm seed
```

Создаются: одобренная организация, организатор `demo.organizer@example.test`, шесть мероприятий с регистрациями и билетами, листы ожидания (FIFO) и завершённое мероприятие с 19 отметками о посещении. Адреса используют домен `example.test`, письма не создаются.

Пароль организатора **не печатается** при заполнении и не попадает в логи. Чтобы его узнать:

```sh
docker compose -f compose.demo.yaml run --rm demo-password
```

Пароль был сгенерирован при первом запуске и хранится в томе `demo-secrets`; он действует, пока том не удалён.

### 5. Открыть приложение

- Публичная часть: http://localhost:3000
- Кабинет организатора: http://localhost:3000/organizer (email `demo.organizer@example.test`, пароль из шага 4)

Используйте именно `localhost`, а не `127.0.0.1`: запросы, изменяющие данные, принимаются только с адреса `http://localhost:3000`. Браузеры Chromium (Chrome, Edge) и Firefox принимают cookie с префиксом `__Host-` на `http://localhost`; Safari не проверялся.

### 6. Почтовый ящик (поддельный email)

Все «отправленные» письма (подтверждения, билеты, ссылки) видны здесь: **http://localhost:3000/dev/mailbox**. Письма отправляет worker с задержкой в несколько секунд; обновите страницу.

### 7. Остановка

```sh
docker compose -f compose.demo.yaml stop        # остановить, ничего не удаляя
docker compose -f compose.demo.yaml down        # удалить контейнеры, ДАННЫЕ СОХРАНЯЮТСЯ (тома остаются)
```

### 8. Перезапуск без потери данных

```sh
docker compose -f compose.demo.yaml up -d
```

(`--build` нужен только после изменения кода.) База, изображения, письма и пароль организатора сохраняются.

### 9. Полный сброс (УДАЛЯЕТ ВСЕ ДЕМО-ДАННЫЕ)

> **Внимание.** Команда ниже безвозвратно удаляет тома этого демо-стека (`eventflow-demo_*`): базу данных, изображения, письма и секреты. Другие проекты Docker не затрагиваются, так как имя проекта `eventflow-demo` отдельное, но убедитесь, что вам не нужны данные демо.

```sh
docker compose -f compose.demo.yaml down -v
```

После этого начните с шага 3 (секреты и пароль будут созданы заново).

### Если что-то не работает

- Порт 3000 занят другой программой: остановите её; порт задан в `compose.demo.yaml` (`127.0.0.1:3000:3000`), и адрес `PUBLIC_ORIGIN` должен совпадать с ним.
- Логи: `docker compose -f compose.demo.yaml logs web worker postgres`.
- Сборка падает без доступа в интернет: образу нужны `node:24-bookworm-slim`, `postgres:18` и пакеты apt/npm при сборке.

---

## Способ B. Ручная установка для разработки

Нужны: **Node.js 24**, **pnpm 12.11.2**, **PostgreSQL 18**, Git. Подробности: [README.md](../README.md) (разделы 1–3).

### Командная оболочка

Команды ниже записаны для оболочки POSIX (bash/zsh). В **Windows** используйте **Git Bash** (идёт вместе с Git for Windows): `cp`, подстановка `NAME=value команда` и `\` для переноса строк в PowerShell не работают. Если вы всё же в PowerShell, различия такие:

- Копировать файл: `cp .env.example .env` (Git Bash) или `Copy-Item .env.example .env` (PowerShell).
- Перенос строки в команде: `\` (Git Bash) или обратная кавычка `` ` `` (PowerShell).
- Переменная для одной команды: `PGPASSWORD=… psql …` (Git Bash) или `$env:PGPASSWORD='…'; psql …` (PowerShell).

`pnpm`-команды (`pnpm install`, `pnpm migrate` и т.д.) одинаковы во всех оболочках.

### 1. Node.js 24 и pnpm 12.11.2

- **Windows:** установщик с [nodejs.org](https://nodejs.org/) (версия 24.x) или `winget install OpenJS.NodeJS`.
- **macOS:** `brew install node@24` (или установщик с nodejs.org).
- **Linux:** пакет вашего дистрибутива из репозитория NodeSource либо `nvm install 24`.

Версию pnpm задаёт поле `packageManager` в `package.json`; её подтягивает Corepack:

```sh
node --version        # v24.x
corepack enable
pnpm --version        # 12.11.2 (после первой команды pnpm в репозитории)
```

### 2. PostgreSQL 18

- **Windows:** установщик EDB с [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) либо контейнер ниже.
- **macOS:** `brew install postgresql@18 && brew services start postgresql@18`.
- **Linux:** пакеты `postgresql-18` из репозитория [apt.postgresql.org](https://www.postgresql.org/download/linux/) (Debian/Ubuntu) или аналог вашего дистрибутива.
- **Любая ОС, если установлен Docker:** `docker run -d --name ers-postgres -e POSTGRES_PASSWORD=<пароль-суперпользователя> -p 127.0.0.1:5432:5432 postgres:18`.

### 3. Клонирование и зависимости

```sh
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
git checkout dev
pnpm install
```

### 4. Создание ролей и баз данных (один раз)

Скрипт создаёт роли `app_owner` (миграции) и `app_runtime` (веб и worker), базы `ers_dev` и `ers_test`. Придумайте два пароля.

Git Bash / Linux / macOS:

```sh
psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 \
  -v owner_password='<пароль-owner>' -v runtime_password='<пароль-runtime>' \
  -f scripts/provision-local-db.sql
```

PowerShell:

```powershell
psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 `
  -v owner_password='<пароль-owner>' -v runtime_password='<пароль-runtime>' `
  -f scripts/provision-local-db.sql
```

`psql` спросит пароль суперпользователя. Утилита `psql` входит в клиентские инструменты PostgreSQL; она должна быть в `PATH`.

### 5. Настройка `.env`

```sh
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

В `.env`:

- подставьте пароли и порт в четыре строки `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`;
- замените четыре секрета (`CSRF_SECRET`, `PRESESSION_SECRET`, `RATE_LIMIT_SECRET`, `PREVIEW_SECRET`) случайными строками от 32 символов, например: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (по одному значению на секрет).

Файл `.env` не попадает в Git.

### 6. Миграции и демо-данные

```sh
pnpm migrate
pnpm seed:demo
```

`seed:demo` работает только с локальной базой, отказывается запускаться при `NODE_ENV=production`, идемпотентен. При первом запуске он один раз печатает пароль организатора `demo.organizer@example.test`. Чтобы задать свой пароль (от 12 символов), задайте `DEMO_ORGANIZER_PASSWORD` до первого запуска (Git Bash: `DEMO_ORGANIZER_PASSWORD='…' pnpm seed:demo`; PowerShell: `$env:DEMO_ORGANIZER_PASSWORD='…'; pnpm seed:demo`). Такой пароль не печатается.

### 7. Запуск (три терминала)

```sh
pnpm dev:web        # API на http://127.0.0.1:3000
pnpm dev:worker     # отправка писем (в файлы) и напоминания
pnpm dev:client     # Vite на http://localhost:5173
```

- Кабинет организатора: http://localhost:5173/organizer
- Почтовый ящик разработки: http://localhost:5173/dev/mailbox

Используйте `localhost`, а не `127.0.0.1`.

### Проверка тестов (по желанию)

Серверные и браузерные тесты пересоздают тестовую базу `ers_test`; не запускайте их одновременно. Команды: README, раздел 5.
