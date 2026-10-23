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
