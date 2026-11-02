# NoteFlow AI API

Node.js and Express API for NoteFlow AI. Firebase Authentication verifies user
identity, and Cloud Firestore stores private user data by default.

## Setup

1. Install Node.js 20 or newer.
2. From this directory, install dependencies with `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `FIREBASE_PROJECT_ID=noteflowai-73991`, matching the frontend Firebase app.
5. Set `STORAGE_DRIVER=firestore` (the default) and optionally
   `FIRESTORE_DATABASE_ID` (defaults to `(default)`). To opt in to Neon
   PostgreSQL instead, set `STORAGE_DRIVER=postgres` and `DATABASE_URL` to the
   Neon connection string in `backend/.env`. Keep the connection string
   server-side; it must never use a `VITE_` prefix.
6. Configure Firebase Admin credentials on the server using either:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` with the service-account JSON, or
   - `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account file, or
   - Application Default Credentials when running in a supported Google Cloud environment.
7. Keep service-account credentials server-side, outside source control. The Firebase web config in the frontend is not an Admin credential.
8. Deploy `firestore.rules` and `firestore.indexes.json` from the repository root with `firebase deploy --only firestore:rules,firestore:indexes`. The API uses the Admin SDK; client SDK access is limited by the deployed rules.
9. Set `CORS_ORIGINS` to a comma-separated list of exact frontend origins.
10. Set `GEMINI_API_KEY` from Google AI Studio and optionally `GEMINI_MODEL` in `backend/.env`. The key stays server-side; `.env` is ignored by Git. The default model is `gemini-2.5-flash`; verify that it is enabled for your key and quota.
11. Configure `AI_GLOBAL_DAILY_REQUEST_LIMIT` (default `10000`) as a service-wide daily request ceiling and `GEMINI_MAX_OUTPUT_TOKENS` (default `2048`, maximum `8192`) to bound generated response size.
12. Run `npm run dev` for local development or `npm start` for production.

Firestore stores profiles at `users/{uid}`, with notes, settings, categories,
and tags in user-scoped subcollections. Billing identifiers and subscription
state are stored separately in `billingAccounts/{uid}` and are not readable by
clients. All API requests derive the user ID from a verified Firebase ID token.
For local development only, `STORAGE_DRIVER=sqlite` uses the legacy SQLite
store at `DATABASE_PATH` (default `backend/data/noteflow.sqlite`); migrations
run automatically.

### Neon PostgreSQL

The PostgreSQL driver is opt-in; the existing Firestore default and SQLite
mode are unchanged. With `STORAGE_DRIVER=postgres` and `DATABASE_URL` set,
startup checks the connection and applies versioned, additive migrations.
You can apply them explicitly with `npm run db:migrate` from this directory.
The schema includes Firebase-UID-scoped users, notes, collections, tags,
settings, chat conversations/messages, subscriptions, and AI usage tables.
All application queries use the verified Firebase UID, parameterized SQL, and
a bounded `pg.Pool`.

Selecting a different driver does not copy, replace, or delete data in
Firestore or SQLite. Existing data remains in its original store; plan and
execute a separate migration before switching a deployed application if that
data must appear in PostgreSQL. Do not point the application at a production
database until its backup and migration strategy are confirmed.

## API

- `GET /api/health` is public and returns service status.
- All `/api/notes`, `/api/categories`, `/api/tags`, and `/api/search` endpoints require `Authorization: Bearer <Firebase ID token>`.
- Notes support paginated listing, sorting, favorite/archive filtering, create, read, update, delete, favorite, and archive operations.
- `GET /api/search?q=...` searches the authenticated user's unarchived notes with Firestore keyword matching (or SQLite FTS5 when using the optional SQLite driver).
- Categories and tags are scoped to the verified Firebase user. Notes accept a `collection` name and a list of tag names; these are created and linked as needed.
- `GET /api/me` returns the profile synchronized from verified token claims.
- `GET /api/auth/me` returns the verified user's profile and sign-in provider. `POST /api/auth/sync` refreshes the Firestore profile from the verified Firebase token; the request body cannot override account identity or profile data.
- Billing checkout and subscription endpoints require Firebase ID tokens. `GET /api/billing/checkout-sessions/:sessionId` only returns the authenticated user's provider-verified checkout status; success redirects never grant paid access.
- `/api/chat/conversations` and its message endpoints create, list, rename, delete, clear, edit, restore, paginate, and stream messages for the authenticated user's private conversations. Chat writes are validated by Express and scoped to the verified UID in the selected store.
- `GET /api/ai/usage` returns the authenticated user's server-calculated daily allowance, usage count, remaining messages, effective plan, and next UTC midnight reset time.
- `GET/PATCH /api/settings` reads or updates the authenticated user's settings.
- Email/password registration and login, Google popup login, password recovery, persistent browser sessions, and logout are handled by Firebase Authentication in the frontend. The backend never receives or stores user passwords.
- `POST /api/ai/summarize`, `/api/ai/improve`, `/api/ai/title`, `/api/ai/tags`, and `/api/ai/ask` call Gemini for a note owned by the signed-in user or unsaved note text sent by that user. All return `{ "result": ... }`; tags returns an array. Requests accept `content`, optional `title`, optional `noteId` for a saved owned note, and `question` for `/ask`.
- Chat and note-AI calls reserve usage atomically in Firestore, SQLite, or PostgreSQL before calling Gemini. Free, Plus, and Pro (the existing internal `team` billing ID) receive 20, 200, and 1,000 requests per UTC day. Failed model attempts count; reused request IDs are rejected without a second charge. An additional service-wide daily ceiling is controlled by `AI_GLOBAL_DAILY_REQUEST_LIMIT`. Gemini output is bounded by `GEMINI_MAX_OUTPUT_TOKENS`.
- Free users may save up to 30 notes; Plus users up to 500; Pro has no plan-level note count. Note limits and paid AI summaries are enforced server-side from provider-synchronized subscription state, not client plan fields. Each note remains subject to existing input validation and its 50,000-character content cap.
- AI routes are Firebase-protected and have a separate per-IP rate limit. Missing Gemini configuration, quota exhaustion, and upstream errors return safe, explicit error responses.
- `/pricing` and the landing page show Free, Plus, and Pro; the existing `STRIPE_PRICE_TEAM` configuration and `team` subscription ID remain for compatibility. Stripe wallets are conditional on Stripe account, domain, browser, and device configuration; successful live billing still requires deployment-specific verification.

Search currently uses per-user keyword matching. Semantic/vector search is not implemented and is not included in the Plus feature list yet.

The API never accepts a user ID from the client. Firebase ID tokens determine identity and all database reads and writes are scoped to the associated Firebase UID. Chat generation uses the installed Google GenAI SDK directly in Node; Gemini credentials remain server-only. Browser cancellation aborts the SDK request and retains any text already streamed, although the provider may still bill an interrupted generation.

## Development

```powershell
npm test
npm run dev
```

The API defaults to port `3000`. The frontend Vite server proxies `/api` requests to `http://localhost:3000`.

To run Auth and Firestore emulators, use `firebase emulators:start --only auth,firestore --project demo-noteflow` from the repository root. Set `FIREBASE_PROJECT_ID=demo-noteflow`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` for the API. Emulator hosts must never be set in production.

The chat API stores conversations and messages in `users/{uid}/conversations/{conversationId}` and its `messages` subcollection. The backend verifies Firebase ID tokens and scopes every operation to the verified UID. Message pages use their sequence number as a cursor; Firestore uses the existing per-user conversation hierarchy and automatic single-field indexes.
