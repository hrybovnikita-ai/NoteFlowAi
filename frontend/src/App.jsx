import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import "./App.css";
import { CheckoutPage, CheckoutResult, LegalPage } from "./billing/Billing";
import PricingPage from "./billing/Pricing";
import { getFirebaseAuthMessage } from "./auth/firebaseAuthErrors";
import Main from "./components/Main/Main";
import Footer from "./components/Footer/Footer";
import DashboardLayout, {
  CollectionsPage,
  DashboardHome,
  NoteEditorPage,
  NotesPage,
  SearchPage,
  SettingsPage,
  TagsPage,
} from "./components/Dashboard/Dashboard";
const ChatPage = lazy(() => import("./chat/Chat"));
const KnowledgeGraphPage = lazy(() => import("./features/KnowledgeGraph"));
const DocumentsPage = lazy(() => import("./features/Documents"));
const TasksPage = lazy(() => import("./features/Tasks"));

function LandingPage({ onEmailPasswordAuth, onGoogleSignIn, onPasswordReset, autoOpenAuth = false, initialMode = "login", firebaseError = "", authNotice = "" }) {
  const authDialogRef = useRef(null);
  const location = useLocation();
  const [authMode, setAuthMode] = useState(initialMode);
  const [authMessage, setAuthMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isGoogleAuthenticating, setIsGoogleAuthenticating] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!autoOpenAuth && !authNotice) return;
    if (!authDialogRef.current) return;
    if (!authDialogRef.current.open) {
      authDialogRef.current.showModal();
      setAuthMode(initialMode);
    }
    setAuthMessage(location.state?.authMessage ?? authNotice ?? "");
  }, [autoOpenAuth, initialMode, location.state, authNotice]);

  function openAuthDialog(mode) {
    setIsMobileNavOpen(false);
    setAuthMode(mode);
    setAuthMessage("");
    setShowPassword(false);
    authDialogRef.current?.showModal();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const fullName = String(formData.get("fullName") || "");
    if (authMode === "signup" && password !== formData.get("confirmPassword")) {
      setAuthMessage("The passwords do not match.");
      return;
    }

    setIsAuthenticating(true);
    setAuthMessage("");
    try {
      if (authMode === "reset") {
        await onPasswordReset(email);
        setAuthMessage("If an account exists for that email, password reset instructions will be sent.");
      } else {
        await onEmailPasswordAuth(email, password, authMode, fullName);
      }
    } catch (error) {
      setAuthMessage(authMode === "reset" && error?.code === "auth/user-not-found"
        ? "If an account exists for that email, password reset instructions will be sent."
        : getFirebaseAuthMessage(error));
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleGoogleSignIn() {
    if (firebaseError) {
      setAuthMessage(firebaseError || "Firebase is not configured. Check frontend/.env.local.");
      return;
    }

    setIsGoogleAuthenticating(true);
    setAuthMessage("");
    try {
      const credential = await onGoogleSignIn();
      if (credential?.redirecting) return;
      if (!credential?.user) {
        throw new Error("Firebase did not return an authenticated user.");
      }
    } catch (error) {
      if (error?.code === "auth/account-exists-with-different-credential") {
        setAuthMode("login");
        setAuthMessage("An account already exists with this email using another sign-in method. Sign in with that method below to link Google to the same account.");
      } else {
        setAuthMessage(getFirebaseAuthMessage(error, "google"));
      }
    } finally {
      setIsGoogleAuthenticating(false);
    }
  }

  return (
    <div>
      <header className="site-header">
        <nav className={`navbar page-container${isMobileNavOpen ? " is-menu-open" : ""}`}>
          <Link className="logo" to="/"><img src="/favicon.png" alt="" />NoteFlowAi</Link>
          <button
            className="nav-menu-toggle"
            type="button"
            aria-label={isMobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMobileNavOpen}
            aria-controls="primary-navigation"
            onClick={() => setIsMobileNavOpen((open) => !open)}
          >
            <span aria-hidden="true">{isMobileNavOpen ? "×" : "☰"}</span>
          </button>
          <ul className="nav-links" id="primary-navigation">
            <li><a href="#home" onClick={() => setIsMobileNavOpen(false)}>Home</a></li>
            <li><a href="#features" onClick={() => setIsMobileNavOpen(false)}>Features</a></li>
            <li><Link to="/pricing" onClick={() => setIsMobileNavOpen(false)}>Pricing</Link></li>
            <li><a href="#contact" onClick={() => setIsMobileNavOpen(false)}>Contact</a></li>
          </ul>

          <div className="nav-actions">
            <button type="button" className="btn-primary" onClick={() => openAuthDialog("login")}>Log in</button>
            <button type="button" className="btn-secondary" onClick={() => openAuthDialog("signup")}>Sign up</button>
          </div>
        </nav>
      </header>

      <Main />
      <Footer />

      <dialog
        className="auth-dialog"
        ref={authDialogRef}
        aria-labelledby="auth-dialog-title"
        aria-describedby="auth-dialog-description"
        onClose={() => setAuthMessage("")}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <button className="auth-dialog-close" type="button" aria-label="Close dialog" onClick={() => authDialogRef.current?.close()}>
          &times;
        </button>
        <span className="auth-dialog-brand"><img src="/favicon.png" alt="" />NoteFlowAi</span>
        <h2 id="auth-dialog-title">{authMode === "signup" ? "Create your account" : authMode === "reset" ? "Reset your password" : "Welcome back"}</h2>
        <p id="auth-dialog-description">{authMode === "reset" ? "Enter your email and we’ll send password reset instructions if an account exists." : "Add your details to continue to your NoteFlowAi workspace."}</p>

        {firebaseError && (
          <p className="auth-config-notice" role="status">{firebaseError}</p>
        )}

        <form
          className="auth-form"
          onSubmit={handleAuthSubmit}
          onInvalid={(event) => {
            const emailField = event.currentTarget.elements.namedItem("email");
            const passwordField = event.currentTarget.elements.namedItem("password");
            const errors = [];
            if (!emailField.validity.valid) errors.push("Enter a valid email address.");
            if (authMode !== "reset" && passwordField && !passwordField.validity.valid) errors.push(passwordField.validity.tooShort ? "Your password must be at least 8 characters." : "Enter your password.");
            if (authMode === "signup") {
              const nameField = event.currentTarget.elements.namedItem("fullName");
              const confirmField = event.currentTarget.elements.namedItem("confirmPassword");
              if (!nameField.validity.valid) errors.push("Enter your full name.");
              if (!confirmField.validity.valid) errors.push("Confirm your password.");
            }
            setAuthMessage(errors.join(" "));
          }}
          onChange={() => setAuthMessage("")}
        >
          {authMode === "signup" && (
            <>
              <label htmlFor="auth-full-name">Full name</label>
              <input id="auth-full-name" name="fullName" type="text" autoComplete="name" placeholder="Your name" minLength={2} maxLength={80} required />
            </>
          )}
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />

          {authMode !== "reset" && (
            <>
              <label htmlFor="auth-password">Password</label>
              <div className="auth-password-field">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  aria-controls="auth-password"
                  title={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={22} strokeWidth={2} aria-hidden /> : <Eye size={22} strokeWidth={2} aria-hidden />}
                </button>
              </div>
            </>
          )}

          {authMode === "signup" && (
            <>
              <label htmlFor="auth-confirm-password">Confirm password</label>
              <div className="auth-password-field">
                <input
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  minLength={8}
                  required
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showPassword}
                  aria-controls="auth-confirm-password"
                  title={showPassword ? "Hide confirm password" : "Show confirm password"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={22} strokeWidth={2} aria-hidden /> : <Eye size={22} strokeWidth={2} aria-hidden />}
                </button>
              </div>
            </>
          )}

          {authMode === "login" && (
            <button className="auth-inline-action" type="button" onClick={() => openAuthDialog("reset")}>Forgot password?</button>
          )}
          <button className="auth-submit" type="submit" disabled={isAuthenticating || isGoogleAuthenticating}>
            {isAuthenticating
              ? authMode === "signup" ? "Creating account…" : authMode === "reset" ? "Sending instructions…" : "Logging in…"
              : authMode === "signup" ? "Sign up" : authMode === "reset" ? "Send reset link" : "Log in"}
          </button>
          {authMode !== "reset" && <div className="auth-divider"><span>or</span></div>}
          {authMode !== "reset" && <button className="auth-google" type="button" disabled={isGoogleAuthenticating || isAuthenticating} onClick={handleGoogleSignIn}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.27 3.38v2.77h3.67c2.15-1.98 3.65-4.9 3.65-8.18Z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.92l-3.67-2.77c-1.08.72-2.45 1.15-4.28 1.15-3.29 0-6.07-2.22-7.06-5.2H1.15v2.85A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M4.94 14.26a7.2 7.2 0 0 1 0-4.52V6.89H1.15a12 12 0 0 0 0 11.22l3.79-2.85Z" />
              <path fill="#EA4335" d="M12 4.77c1.77 0 3.36.61 4.61 1.82l3.44-3.44C17.95 1.18 15.24 0 12 0A12 12 0 0 0 1.15 6.89l3.79 2.85c.99-2.98 3.77-4.97 7.06-4.97Z" />
            </svg>
            {isGoogleAuthenticating
              ? "Connecting to Google..."
              : authMode === "signup" ? "Sign up with Google" : "Log in with Google"}
          </button>}
          {isGoogleAuthenticating && <p className="auth-message" role="status">Waiting for Google authentication…</p>}
          <p className="auth-message" role="alert">{authMessage}</p>
          <p className="auth-mode-switch">
            {authMode === "signup" ? "Already have an account?" : authMode === "reset" ? "Remembered your password?" : "New to NoteFlow AI?"}
            {" "}
            <button type="button" onClick={() => openAuthDialog(authMode === "signup" || authMode === "reset" ? "login" : "signup")}>
              {authMode === "signup" || authMode === "reset" ? "Log in" : "Sign up"}
            </button>
          </p>
        </form>
      </dialog>
    </div>
  );
}

function ProtectedRoute({ session, authLoading, onLogout, logoutError }) {
  const location = useLocation();
  if (authLoading) {
    return <main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Restoring your secure session…</main>;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;

  return <DashboardLayout key={session.uid} session={session} onLogout={onLogout} logoutError={logoutError} />;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user: firebaseUser,
    loading: authLoading,
    firebaseError,
    authNotice,
    register,
    login,
    loginWithGoogle,
    logout: signOutUser,
    sendPasswordReset,
    pendingGoogleLink,
    linkPendingGoogleAccount,
    googleRedirectComplete,
    consumeGoogleRedirect,
  } = useAuth();
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (!firebaseUser || !googleRedirectComplete) return;
    navigate("/dashboard", { replace: true });
    consumeGoogleRedirect();
  }, [firebaseUser, googleRedirectComplete, consumeGoogleRedirect, navigate]);

  async function authenticateWithEmailPassword(email, password, mode, fullName) {
    const credential = mode === "signup"
      ? await register(fullName, email, password)
      : await login(email, password);
    if (!credential.user) {
      throw new Error("Firebase did not confirm a signed-in user.");
    }
    if (mode === "login" && pendingGoogleLink) await linkPendingGoogleAccount(credential.user);

    navigate("/dashboard", { replace: true });
    return credential;
  }

  async function authenticateWithGoogle() {
    const credential = await loginWithGoogle();
    if (credential?.redirecting) return credential;
    if (!credential?.user) {
      throw new Error("Firebase did not confirm a signed-in user.");
    }

    navigate("/dashboard", { replace: true });
    return credential;
  }

  async function logout() {
    setLogoutError("");

    try {
      await signOutUser();
      navigate("/", { replace: true });
      return true;
    } catch (error) {
      setLogoutError(error instanceof Error ? `Could not log out: ${error.message}` : "Could not log out. Please try again.");
      return false;
    }
  }

  const session = firebaseUser
    ? {
      authType: "firebase",
      uid: firebaseUser.uid,
      displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "NoteFlow user",
      email: firebaseUser.email || "",
      photoURL: firebaseUser.photoURL || "",
      provider: firebaseUser.providerData?.some(({ providerId }) => providerId === "google.com")
        ? "Google"
        : firebaseUser.providerData?.some(({ providerId }) => providerId === "password")
          ? "Email/password"
          : "Firebase",
    }
    : null;
  const landingProps = {
    onEmailPasswordAuth: authenticateWithEmailPassword,
    onGoogleSignIn: authenticateWithGoogle,
    onPasswordReset: sendPasswordReset,
    firebaseError,
    authNotice,
  };

  function authLanding(mode) {
    if (authLoading) {
      return <main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Restoring your secure session…</main>;
    }
    if (session) return <Navigate to="/dashboard" replace />;
    return <LandingPage {...landingProps} autoOpenAuth initialMode={mode} />;
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage {...landingProps} />} />
      <Route path="/home" element={<LandingPage {...landingProps} />} />
      <Route path="/login" element={authLanding("login")} />
      <Route path="/register" element={authLanding("signup")} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/checkout" element={<CheckoutPage key={location.search} />} />
      <Route path="/checkout/success" element={<CheckoutResult />} />
      <Route path="/checkout/cancel" element={<CheckoutResult canceled />} />
      <Route path="/terms" element={<LegalPage />} />
      <Route path="/privacy" element={<LegalPage privacy />} />
      <Route path="/signup" element={authLanding("signup")} />
      <Route path="/dashboard" element={<ProtectedRoute session={session} authLoading={authLoading} onLogout={logout} logoutError={logoutError} />}>
        <Route index element={<DashboardHome />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="notes/new" element={<NoteEditorPage key="new-note" />} />
        <Route path="notes/:noteId/edit" element={<NoteEditorPage key="edit-note" />} />
        <Route path="favorites" element={<NotesPage favoritesOnly />} />
        <Route path="collections" element={<CollectionsPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="knowledge-graph" element={<Suspense fallback={<main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Loading knowledge graph…</main>}><KnowledgeGraphPage /></Suspense>} />
        <Route path="documents" element={<Suspense fallback={<main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Loading documents…</main>}><DocumentsPage /></Suspense>} />
        <Route path="tasks" element={<Suspense fallback={<main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Loading tasks…</main>}><TasksPage /></Suspense>} />
        <Route path="pricing" element={<PricingPage embedded />} />
        <Route path="settings" element={<SettingsPage session={session} onLogout={logout} logoutError={logoutError} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="/chat" element={<ProtectedRoute session={session} authLoading={authLoading} onLogout={logout} logoutError={logoutError} />}>
        <Route index element={<Suspense fallback={<main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Loading chat…</main>}><ChatPage key={`${session?.uid}:${location.pathname}`} /></Suspense>} />
      </Route>
      <Route path="/chat/:conversationId" element={<ProtectedRoute session={session} authLoading={authLoading} onLogout={logout} logoutError={logoutError} />}>
        <Route index element={<Suspense fallback={<main className="auth-loading-screen" aria-live="polite"><span className="auth-loading-spinner" />Loading chat…</main>}><ChatPage key={`${session?.uid}:${location.pathname}`} /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
