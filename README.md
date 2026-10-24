# Driva starter package

What is in here:

- `CLAUDE.md`: the rules and business facts Claude Code reads at the start of every session.
- `docs/ARCHITECTURE.md`, `docs/VERSION1.md`, `docs/API.md`: how it fits together, what version 1 includes, the build order, and the endpoint outline.
- `database/schema.sql`: 26 tables for PostgreSQL 16 with PostGIS. Tested for the key rules (one active trip per driver, one accepted offer per request, minimum 2 hours, append only audit log).
- `docs/prototype/`: the clickable prototypes. Open `DrivaRedesign.html` in a browser. This is the design to match.
- `docs/FIRSTPROMPT.md`: the first message to give Claude Code.

## How to start

1. Create a private GitHub repository called driva and put this folder's contents in it.
2. Open the repository in Claude Code (terminal, web or desktop).
3. Paste the message from `docs/FIRSTPROMPT.md`.
4. Review each step before moving to the next. Have your technical lead approve anything touching payments, vetting data or security.

## Try it

Everything runs on one computer with [Docker Desktop](https://www.docker.com/products/docker-desktop/):

```sh
git clone https://github.com/dondreyy/Driva-App.git
cd Driva-App
docker compose up --build
```

The first build takes several minutes. Then open:

| What | On this computer | On a phone on the same Wi-Fi |
|---|---|---|
| Client app | http://localhost:8081 | http://YOUR-COMPUTER-IP:8081 |
| Driver app | http://localhost:8082 | http://YOUR-COMPUTER-IP:8082 |
| Admin dashboard | http://localhost:3001 | (use the computer) |

- **Login codes** are not texted in the demo. Read them with `docker compose logs api | grep "code is"`.
- **Staff sign in:** the demo VeriQuest officer is 0803 555 0100.
- **Places:** the demo knows a few sample places. Search "Lekki", "Victoria", "Ikoyi", "Ajah" or "Airport".
- **Location:** browsers only share location on `localhost` or HTTPS, so on a phone search for the pickup instead.
- **Start again:** `docker compose down -v` wipes the demo data.

For development, running the apps on a real phone, and production settings, see `docs/DEVELOPMENT.md`.
