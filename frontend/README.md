# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Responsive layout

Shared layout variables and all eight viewport ranges live in `src/index.css`.
Use `.page-container` for new page shells. Containers grow to 192rem of usable
content; typography and spacing scale separately. Feature grids use one column
below 768px, two from 768px, and three from 1024px. Component-specific rules
remain in App.css, Main.css, Form.css, and Footer.css.

## Browser verification

`scripts/responsive-check.mjs` checks the twelve requested viewport widths,
container alignment, horizontal overflow, card overlap, grid columns, section
navigation, note submission, and wrapping a 1000-character note. It saves JSON
results and screenshots to `artifacts/responsive/`.

Run Vite on port 5174, then run `node scripts/responsive-check.mjs` from frontend.
The script uses an existing Playwright Core installation: set PLAYWRIGHT_MODULE
to its module directory and CHROMIUM_PATH to an installed Chromium executable,
or have playwright-core and its browser available normally. No dependency was
added to this project. Build: `npm run build`. Lint: `npm run lint`.

Home, Features, Pricing, and Contact navigation links jump to their matching
sections. Pricing cards and community quotes are sample content for the demo;
the Contact section links to the quick-note form.

## Dashboard and API

The app includes `/dashboard` and nested notes, favorites, collections, tags,
search, and settings routes. Firebase Authentication protects dashboard routes.
The dashboard obtains a Firebase ID token and sends it to the API as a Bearer
token; it does not use a demo session or browser storage as authentication.

Notes, profiles, settings, categories, and tags persist in Cloud Firestore,
scoped to the verified Firebase UID. Billing state is stored server-side and
cannot be read by browser clients. Search uses per-user keyword matching in
Firestore; semantic search is not connected. Archived notes are excluded from
the default notes list.
The note editor offers Gemini summarize, improve, title, tag, and question
actions. Suggestions are previewed first and only applied to the editor when
you choose to apply them.

Start the API in `backend` with `npm install` and `npm run dev`, then start the
frontend with `npm run dev`. Vite proxies `/api` requests to `http://localhost:3000`.
Set `VITE_API_BASE_URL` at build time when the API is hosted at a different
origin. Backend Firebase Admin credentials must be configured server-side as
documented in `backend/README.md`. Build: `npm run build`. Lint: `npm run lint`.
The Firebase action unit tests use mocked SDK calls and run with `npm test` from
the frontend directory.
Configure `GEMINI_API_KEY` and optionally `GEMINI_MODEL` only in
`backend/.env`; never add the Gemini key to a `VITE_` variable or frontend
environment file.

## Firebase Google sign-in

The Firebase web app configuration is read from the existing
`frontend/.env.local`; this app requires project ID `noteflowai-73991`. Set
`VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and
`VITE_FIREBASE_APP_ID` (storage bucket and sender ID are optional for Auth).
Do not commit that local file. `frontend/firebase.js` initializes Firebase
Auth; email/password, Google popup sign-in with redirect fallback, password
reset, and browser-local session persistence are handled by Firebase. Login
and registration land on `/dashboard`; selected pricing intent remains saved
until the user explicitly continues to checkout. Google accounts can add
password sign-in from Dashboard → Settings, linking to the same Firebase UID.
The API independently verifies each ID token using server-only Firebase Admin
credentials. Startup rejects a different project ID or an already-initialized
Firebase app for another project. The optional
`VITE_FIREBASE_AUTH_EMULATOR_HOST` setting is for local emulator testing only.

Keep `VITE_FIREBASE_AUTH_DOMAIN=noteflowai-73991.firebaseapp.com` for local
development unless a custom Firebase Auth domain has been fully configured.
For a custom production domain, point this setting at the Firebase-supported
auth handler domain, add the app hostname under Firebase Console →
Authentication → Settings → Authorized domains, and update the Google OAuth
authorized redirect URI in the provider configuration. Keep `localhost`
authorized for local use.
Enable Email/Password and Google providers.
Enable email enumeration protection to keep password-recovery responses
indistinguishable for existing and unknown addresses. Set Firebase Admin
credentials for the backend separately; do not copy Admin credentials into this
frontend. The Vite dev and preview servers set
`Cross-Origin-Opener-Policy: same-origin-allow-popups` for popup compatibility;
configure the same header on the production web server if its policy requires
Cross-Origin-Opener-Policy. Real Google account selection cannot be automated
without an interactive user account.

Deploy the Firestore rules and indexes from the repository root with
`firebase deploy --only firestore:rules,firestore:indexes`. Authenticated
clients may read only their own profile and private subcollections; Firestore
writes and billing documents are restricted to the trusted API/Admin SDK.
