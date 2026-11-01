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

Notes persist in the backend SQLite database and are scoped to the verified
Firebase user. Search uses SQLite FTS5 keyword search; semantic search is not
connected. Archived notes are excluded from the default notes list.
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
`frontend/.env.local`; do not commit that local file. `frontend/firebase.js`
initializes Firebase Auth and the landing-page Google button uses Firebase's
popup flow. Firebase's browser-local auth persistence restores signed-in users
after a refresh. No demo or browser-stored flag is used as proof of
authentication.

Add the deployed website hostname to Firebase Console → Authentication →
Settings → Authorized domains. Enable Email/Password and Google providers.
Enable email enumeration protection to keep password-recovery responses
indistinguishable for existing and unknown addresses. Set Firebase Admin
credentials for the backend separately; do not copy Admin credentials into this
frontend. The Vite dev and preview servers set
`Cross-Origin-Opener-Policy: same-origin-allow-popups` for popup compatibility;
configure the same header on the production web server if its policy requires
Cross-Origin-Opener-Policy. Real Google account selection cannot be automated
without an interactive user account.
