# NoteFlow AI API

Node.js, Express, Firebase Authentication, and SQLite API for NoteFlow AI.

## Setup

1. Install Node.js 20 or newer.
2. From this directory, install dependencies with `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `FIREBASE_PROJECT_ID` to the same Firebase project used by the frontend.
5. Configure Firebase Admin credentials on the server using either:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` with the service-account JSON, or
   - `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account file, or
   - Application Default Credentials when running in a supported Google Cloud environment.
6. Keep service-account credentials server-side, outside source control. The Firebase web config in the frontend is not an Admin credential.
7. Set `CORS_ORIGINS` to a comma-separated list of exact frontend origins.
8. Set `GEMINI_API_KEY` from Google AI Studio and optionally `GEMINI_MODEL` in `backend/.env`. The key stays server-side; `.env` is ignored by Git. The default model is `gemini-2.5-flash`; verify that it is enabled for your key and quota.
9. Run `npm run dev` for local development or `npm start` for production.

SQLite data is persisted at `DATABASE_PATH`; by default it is written to `backend/data/noteflow.sqlite`. Schema migration runs automatically at startup.

## API

- `GET /api/health` is public and returns service status.
- All `/api/notes`, `/api/categories`, `/api/tags`, and `/api/search` endpoints require `Authorization: Bearer <Firebase ID token>`.
- Notes support paginated listing, sorting, favorite/archive filtering, create, read, update, delete, favorite, and archive operations.
- `GET /api/search?q=...` searches the authenticated user's unarchived notes with SQLite FTS5.
- Categories and tags are scoped to the verified Firebase user. Notes accept a `collection` name and a list of tag names; these are created and linked as needed.
- `GET /api/me` returns the profile synchronized from verified token claims.
- `GET /api/auth/me` returns the verified user's profile and sign-in provider. `POST /api/auth/sync` refreshes the local profile from the verified Firebase token; the request body cannot override account identity or profile data.
- Email/password registration and login, Google popup login, password recovery, persistent browser sessions, and logout are handled by Firebase Authentication in the frontend. The backend never receives or stores user passwords.
- `POST /api/ai/summarize`, `/api/ai/improve`, `/api/ai/title`, `/api/ai/tags`, and `/api/ai/ask` call Gemini for a note owned by the signed-in user or unsaved note text sent by that user. All return `{ "result": ... }`; tags returns an array. Requests accept `content`, optional `title`, optional `noteId` for a saved owned note, and `question` for `/ask`.
- AI routes are Firebase-protected and have a separate per-IP rate limit. Missing Gemini configuration, quota exhaustion, and upstream errors return safe, explicit error responses.

The API never accepts a user ID from the client. Firebase ID tokens determine identity and all database queries are scoped to the associated local user record.

## Development

```powershell
npm test
npm run dev
```

The API defaults to port `3000`. The frontend Vite server proxies `/api` requests to `http://localhost:3000`.
