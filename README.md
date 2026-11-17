# Hotel Management

A hotel property-management system, developed one verified feature at a time.

## Current scaffold

- `frontend/`: React and Vite web client.
- `backend/`: Express API with `GET /api/health`.
- `docs/`: requirements, architecture, roadmap, backlog, status, decisions, and test strategy.

## Run locally

Start the API in one terminal:

```powershell
npm --prefix backend start
```

Start the web client in another:

```powershell
npm --prefix frontend run dev
```

The API listens on port `3000` by default; set `PORT` to override it. Hotel workflows and hotel-data persistence are not implemented yet.

## Firebase phone authentication

The frontend reads its Firebase web-app configuration from `frontend/.env.local`.
Copy `frontend/.env.example` to that file and fill in the values from Firebase
Console. In Firebase Console, enable **Phone** as a sign-in provider and add
your deployment domain under Authentication's authorized domains.

## Feature workflow

Use the Copilot prompt commands in `.github/prompts/`:

1. `/project-status` to see verified progress.
2. `/next-feature` to select one dependency-ready item.
3. `/develop-next` to implement that feature.
4. `/test-next` to validate it.
5. `/review-feature` to review the diff.
6. `/update-roadmap` to record verified completion before selecting another feature.

See `docs/FEATURE_BACKLOG.md` for the product feature catalog and dependencies.
