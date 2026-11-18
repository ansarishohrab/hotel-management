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

The API listens on port `3000` by default; set `PORT` to override it.

## Firebase email and password authentication

The frontend reads its Firebase web-app configuration from `frontend/.env.local`.
Copy `frontend/.env.example` to that file and fill in the values from Firebase
Console. In Firebase Console, enable **Email/Password** as a sign-in provider
and add your deployment domain under Authentication's authorized domains.

## Local PostgreSQL onboarding

Firebase Authentication manages email/password accounts. Passwords are never
sent to PostgreSQL; admin profiles and hotel onboarding records are stored in
the local PostgreSQL database through the Express API. The frontend does not
use Firestore.

1. Install PostgreSQL and create a local database, for example:
   `psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE hotel_management;"`.
2. Copy `backend/.env.example` to `backend/.env`, then set `DATABASE_URL` to
   your local PostgreSQL credentials and `FIREBASE_PROJECT_ID` to the project
   used by the frontend Firebase authentication configuration. URL-encode special
   characters in the database password.
3. Configure `frontend/.env.local` as described above.
4. Start the API with `npm --prefix backend start`. On startup it creates the
   required `admin_users` and `hotels` tables if they do not exist. The API
   verifies Firebase ID tokens before accessing user-owned records.
5. Start the frontend with `npm --prefix frontend run dev`. Vite proxies `/api`
   requests to the local API at `http://127.0.0.1:3000`.

The admin profile and its primary hotel are saved in PostgreSQL, with hotel
creation/update and the primary-hotel link committed in one database
transaction. Never commit `backend/.env` or `frontend/.env.local`.

## Feature workflow

Use the Copilot prompt commands in `.github/prompts/`:

1. `/project-status` to see verified progress.
2. `/next-feature` to select one dependency-ready item.
3. `/develop-next` to implement that feature.
4. `/test-next` to validate it.
5. `/review-feature` to review the diff.
6. `/update-roadmap` to record verified completion before selecting another feature.

See `docs/FEATURE_BACKLOG.md` for the product feature catalog and dependencies.
