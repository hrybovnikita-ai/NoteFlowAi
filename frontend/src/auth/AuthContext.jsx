import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthContextValue";
import {
  auth,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  firebaseConfigError,
  googleProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "../../firebase";
import { createAuthOperations } from "./authOperations";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [firebaseError, setFirebaseError] = useState(
    firebaseConfigError.length
      ? `Firebase configuration is missing: ${firebaseConfigError.join(", ")}.`
      : "",
  );

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setLoading(false);
        setFirebaseError("");
      },
      (error) => {
        setUser(null);
        setLoading(false);
        setFirebaseError(error.message || "Firebase could not restore the session.");
      },
    );
  }, []);

  const operations = useMemo(() => createAuthOperations({
    auth,
    firebaseError,
    persistence: browserLocalPersistence,
    sdk: {
      createUserWithEmailAndPassword,
      googleProvider,
      sendPasswordResetEmail,
      setPersistence,
      signInWithEmailAndPassword,
      signInWithPopup,
      signOut,
      updateProfile,
    },
  }), [firebaseError]);

  const register = useCallback(async (...args) => {
    const credential = await operations.register(...args);
    setUser(credential.user);
    return credential;
  }, [operations]);

  const login = useCallback(async (...args) => {
    const credential = await operations.login(...args);
    setUser(credential.user);
    return credential;
  }, [operations]);

  const loginWithGoogle = useCallback(async () => {
    const credential = await operations.loginWithGoogle();
    setUser(credential.user);
    return credential;
  }, [operations]);

  const logout = useCallback(async () => {
    await operations.logout();
    setUser(null);
  }, [operations]);

  const value = useMemo(() => ({
    user,
    loading,
    firebaseError,
    register,
    login,
    loginWithGoogle,
    logout,
    sendPasswordReset: operations.sendPasswordReset,
  }), [user, loading, firebaseError, operations, register, login, loginWithGoogle, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
