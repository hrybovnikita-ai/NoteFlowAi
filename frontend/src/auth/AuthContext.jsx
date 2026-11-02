import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthContextValue";
import {
  auth,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  emailCredential,
  firebaseConfigError,
  googleCredentialFromError,
  googleProvider,
  getRedirectResult,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "../../firebase";
import { createAuthOperations } from "./authOperations";
import { getFirebaseAuthMessage } from "./firebaseAuthErrors";

let redirectResultPromise;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState(null);
  const [authNotice, setAuthNotice] = useState("");
  const [googleRedirectComplete, setGoogleRedirectComplete] = useState(false);
  const [authStateReady, setAuthStateReady] = useState(false);
  const [redirectResultReady, setRedirectResultReady] = useState(!auth);
  const loading = Boolean(auth) && !(authStateReady && redirectResultReady);
  const [firebaseError, setFirebaseError] = useState(
    firebaseConfigError.length
      ? `Firebase configuration is missing: ${firebaseConfigError.join(", ")}.`
      : "",
  );

  useEffect(() => {
    if (!auth) return undefined;
    let active = true;
    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setAuthStateReady(true);
        setFirebaseError("");
      },
      (error) => {
        setUser(null);
        setAuthStateReady(true);
        setFirebaseError(getFirebaseAuthMessage(error));
      },
    );
    redirectResultPromise ||= getRedirectResult(auth);
    redirectResultPromise.then((result) => {
      if (!active) return;
      if (result?.user) {
        setUser(result.user);
        setGoogleRedirectComplete(true);
        setAuthNotice("");
      }
    }).catch((error) => {
      if (!active) return;
      if (error?.code === "auth/account-exists-with-different-credential") {
        setPendingGoogleCredential(googleCredentialFromError(error));
      }
      setAuthNotice(getFirebaseAuthMessage(error, "google"));
    }).finally(() => {
      if (active) setRedirectResultReady(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const operations = useMemo(() => createAuthOperations({
    auth,
    firebaseError,
    persistence: browserLocalPersistence,
    sdk: {
      createUserWithEmailAndPassword,
      emailCredential,
      googleProvider,
      linkWithCredential,
      sendPasswordResetEmail,
      setPersistence,
      signInWithEmailAndPassword,
      signInWithPopup,
      signInWithRedirect,
      signOut,
      updateProfile,
    },
  }), [firebaseError]);

  const register = useCallback(async (...args) => {
    const credential = await operations.register(...args);
    setAuthNotice("");
    setUser(credential.user);
    return credential;
  }, [operations]);

  const login = useCallback(async (...args) => {
    const credential = await operations.login(...args);
    setAuthNotice("");
    setUser(credential.user);
    return credential;
  }, [operations]);

  const loginWithGoogle = useCallback(async () => {
    try {
      const credential = await operations.loginWithGoogle();
      if (credential?.redirecting) return credential;
      setPendingGoogleCredential(null);
      setAuthNotice("");
      setUser(credential.user);
      return credential;
    } catch (error) {
      if (error?.code === "auth/account-exists-with-different-credential") {
        setPendingGoogleCredential(googleCredentialFromError(error));
      }
      throw error;
    }
  }, [operations]);

  const linkPendingGoogleAccount = useCallback(async (existingUser) => {
    if (!pendingGoogleCredential) return null;
    const credential = await operations.linkPendingGoogleAccount(pendingGoogleCredential, existingUser);
    setPendingGoogleCredential(null);
    setAuthNotice("");
    setUser(credential.user);
    return credential;
  }, [operations, pendingGoogleCredential]);

  const linkEmailPassword = useCallback(async (password) => {
    const credential = await operations.linkEmailPassword(password, user);
    setUser(credential.user);
    return credential;
  }, [operations, user]);

  const consumeGoogleRedirect = useCallback(() => setGoogleRedirectComplete(false), []);

  const logout = useCallback(async () => {
    await operations.logout();
    setUser(null);
    setPendingGoogleCredential(null);
    setAuthNotice("");
  }, [operations]);

  const value = useMemo(() => ({
    user,
    loading,
    firebaseError,
    authNotice,
    googleRedirectComplete,
    pendingGoogleLink: Boolean(pendingGoogleCredential),
    register,
    login,
    loginWithGoogle,
    linkPendingGoogleAccount,
    linkEmailPassword,
    consumeGoogleRedirect,
    logout,
    sendPasswordReset: operations.sendPasswordReset,
  }), [user, loading, firebaseError, authNotice, googleRedirectComplete, pendingGoogleCredential, operations, register, login, loginWithGoogle, linkPendingGoogleAccount, linkEmailPassword, consumeGoogleRedirect, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
