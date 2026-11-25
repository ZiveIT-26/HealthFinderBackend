# HealthFinder Backend

NestJS API for the HealthFinder app: chat with a medical assistant that does triage and finds doctors in the Košice region.

Other docs:
- [API reference](docs/API.md): every endpoint with request and response examples
- [CLI chat](docs/CLI.md): talk to the backend from the terminal, no frontend or login needed
- [Local models](docs/LOCAL_MODELS.md): run it on Ollama instead of the OpenAI API

## Requirements

- Node.js 22+
- Docker (for PostgreSQL)
- An OpenAI API key and a Tavily API key

## Quick start

From the `HealthFinderBackend` folder:

```powershell
npm install
copy .env.example .env
```

Fill in `.env` (see [Environment](#environment)), then start the database and the server:

```powershell
cd DockerPostgresDB
docker compose up -d
cd ..
npm run start:dev
```

The API runs on `http://localhost:3000`. `GET /` returns `Hello World!` if it is up.

## Environment

Everything is read from `.env`. Never commit it)))

| Variable | Required | What it is                                                                              |
|---|---|-----------------------------------------------------------------------------------------|
| `DB_CONNECTION_STRING` | yes | `postgres://user:mypassword@localhost:65432/healthfinder` for the Docker database below |
| `OPENAI_API_KEY` | yes* | OpenAI key. When set, the backend uses `gpt-4o` and ignores the `LLM_*` variables       |
| `TAVILY_API_KEY` | yes | web search used by the agent                                                            |
| `GOOGLE_CLIENT_ID` | for login | Web OAuth client ID from Google Cloud Console, same one the app uses                    |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_REASONING_EFFORT`, `LLM_TRIAGE_MODEL` | no | only for local models, see [Local models](docs/LOCAL_MODELS.md)                         |
| `PORT` | no | default `3000`                                                                          |

\* Either `OPENAI_API_KEY`, or `LLM_BASE_URL` + `LLM_MODEL`.


## Database

PostgreSQL 16 in Docker, defined in `DockerPostgresDB/docker-compose.yml`:

- host port `65432`, database `healthfinder`, user `user`, password `mypassword`
- container name `healthfinder_db`
- data is kept in the `pgdata` volume

The schema is in `DockerPostgresDB/init.sql`. Tables: `users`, `access_tokens`, `sessions`, `chat_messages`, `user_memories`.

`init.sql` only runs on an empty volume. After it changes, recreate the database (deletes all data):

```powershell
cd DockerPostgresDB
docker compose down -v
docker compose up -d
```

SQL shell:

```powershell
docker exec -it healthfinder_db psql -U user -d healthfinder
```

## Using the API

All `/chat` endpoints need `Authorization: Bearer <token>`. The app gets the token by signing in with Google (`POST /auth/google`).

One message = two requests:

1. `POST /chat` → returns `streamId` and `sessionId`
2. `GET /chat/stream/:streamId` → the answer as a Server-Sent Events stream

Endpoints, events and examples: [docs/API.md](docs/API.md).

For local testing use the [CLI chat](docs/CLI.md). It needs no login.

## Scripts

| Command | What it does |
|---|---|
| `npm run start` | run the server |
| `npm run chat` | [CLI chat](docs/CLI.md) |
| `npm run eval:triage` | check triage on the test cases in `test/triage-cases.yaml` |
| `npm test` | unit tests |

## Where things are

```
src/
  controllers/     HTTP endpoints (chat, auth)
  auth/            database-backed bearer-token guard
  services/
    llm/           agent graph, triage, tools, titles, chat sessions
    db/            all SQL
    auth/          Google sign-in and database-backed access tokens
  config/          prompts.yaml (what the model reads), messages.yaml (what the user sees), llm.config.yaml
  cli/             CLI chat and triage eval
DockerPostgresDB/  docker-compose and init.sql
docs/              API, CLI, local models
```

Prompts and texts are in the YAML files in `src/config`. Be careful with indentation: a wrong indent doesn't break the start, but the feature using that text will fail later.