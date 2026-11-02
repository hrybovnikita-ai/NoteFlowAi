const cors = require("cors");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const { createAuthenticate } = require("./middleware/authenticate");
const { errorHandler } = require("./middleware/errorHandler");
const { createFirebaseTokenVerifier } = require("./services/firebaseAdmin");
const { createNoteRouter } = require("./routes/noteRoutes");
const { createSearchRouter } = require("./routes/searchRoutes");
const { createTaxonomyRouter } = require("./routes/taxonomyRoutes");
const { createAiRouter } = require("./routes/aiRoutes");
const { createAuthRouter } = require("./routes/authRoutes");
const { createGeminiService } = require("./services/geminiService");
const { createGeminiChatService } = require("./services/geminiChatService");
const { createChatRouter } = require("./routes/chatRoutes");
const { HttpError } = require("./utils/httpError");
const { createBillingService } = require('./services/billingService');
const { createAiUsageService } = require("./services/aiUsageService");
const { createKnowledgeGraphRouter } = require("./routes/knowledgeGraphRoutes");
const { createTaskRouter } = require("./routes/taskRoutes");
const { createDocumentRouter } = require("./routes/documentRoutes");
const { createNoteVersionRouter } = require("./routes/noteVersionRoutes");

function createApp({ db, verifyIdToken, aiService, chatAiService, billingProvider }) {
  if (!db) throw new Error("createApp requires a database instance.");
  const tokenVerifier = verifyIdToken || ((token) => createFirebaseTokenVerifier()(token));
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, "This origin is not allowed.", "CORS_ORIGIN_DENIED"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-AI-Request-Id"],
  }));
  const billing = createBillingService(db, billingProvider);
  const aiUsage = createAiUsageService(db);
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    res.json(await billing.webhook(req.body, req.get('stripe-signature')));
  });
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
  }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "NoteFlow AI API" });
  });
  app.get("/api/status", (req, res) => res.json({ status: "ok" }));

  const authenticate = createAuthenticate({ db, verifyIdToken: tokenVerifier });
  const api = express.Router();
  api.use(authenticate);
  api.use('/settings', require('./routes/settingsRoutes').createSettingsRouter(db));
  api.get('/billing/subscription', async (req, res) => res.json(await billing.subscription(req.user.firebaseUid)));
  api.post('/billing/checkout', async (req, res) => res.json(await billing.checkout(req.user, req.body?.plan)));
  api.get('/billing/checkout-sessions/:sessionId', async (req, res) => res.json(await billing.checkoutSession(req.user.firebaseUid, req.params.sessionId)));
  api.post('/billing/portal', async (req, res) => res.json(await billing.portal(req.user.firebaseUid)));
  api.use("/auth", createAuthRouter());
  api.get("/me", (req, res) => res.json({ user: req.user }));
  api.use("/notes", createNoteRouter(db));
  if (db.kind === "postgres") {
    api.use("/notes/:noteId/versions", createNoteVersionRouter(db));
    api.use("/knowledge-graph", createKnowledgeGraphRouter(db));
    api.use("/tasks", createTaskRouter({ db, usageService: aiUsage }));
    api.use("/documents", createDocumentRouter({ db, usageService: aiUsage }));
  }
  api.use("/categories", createTaxonomyRouter(db, "categories"));
  api.use("/tags", createTaxonomyRouter(db, "tags"));
  api.use("/search", createSearchRouter(db));
  api.use("/ai", createAiRouter({ db, aiService: aiService || createGeminiService(), usageService: aiUsage }));
  api.use("/chat", rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (req) => req.user.firebaseUid,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
  }), createChatRouter({ db, aiService: chatAiService || createGeminiChatService(), usageService: aiUsage }));
  app.use("/api", api);

  app.use((req, res, next) => next(new HttpError(404, "Route not found.", "NOT_FOUND")));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
