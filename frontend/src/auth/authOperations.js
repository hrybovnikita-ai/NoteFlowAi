export function createAuthOperations({ auth, firebaseError, persistence, sdk }) {
  function requireAuth() {
    if (!auth) throw new Error(firebaseError || "Firebase is not configured.");
  }

  async function register(fullName, email, password) {
    requireAuth();
    const name = fullName.trim();
    if (name.length < 2 || name.length > 80) throw new Error("Enter your full name (2–80 characters).");

    await sdk.setPersistence(auth, persistence);
    const credential = await sdk.createUserWithEmailAndPassword(auth, email.trim(), password);
    if (!credential.user) throw new Error("Firebase did not confirm the new account.");
    try {
      await sdk.updateProfile(credential.user, { displayName: name });
      await credential.user.reload();
      await credential.user.getIdToken(true);
    } catch (profileError) {
      try {
        await sdk.signOut(auth);
      } catch (signOutError) {
        throw new Error("Your account was created, but its profile could not be saved and the session could not be cleared. Log out before continuing.", { cause: signOutError });
      }
      throw new Error("Your account was created, but the profile could not be saved. Log in and try again.", { cause: profileError });
    }
    return credential;
  }

  async function login(email, password) {
    requireAuth();
    await sdk.setPersistence(auth, persistence);
    return sdk.signInWithEmailAndPassword(auth, email.trim(), password);
  }

  async function loginWithGoogle() {
    requireAuth();
    await sdk.setPersistence(auth, persistence);
    return sdk.signInWithPopup(auth, sdk.googleProvider);
  }

  async function logout() {
    requireAuth();
    return sdk.signOut(auth);
  }

  async function sendPasswordReset(email) {
    requireAuth();
    return sdk.sendPasswordResetEmail(auth, email.trim());
  }

  return { register, login, loginWithGoogle, logout, sendPasswordReset };
}
