export function getFirebaseAuthMessage(error, method = "email") {
  const action = method === "google" ? "Google sign-in" : "Email/password authentication";
  const code = error?.code;

  if (code === "auth/invalid-api-key" || code?.startsWith("auth/api-key-not-valid")) {
    return "Firebase rejected the API key. Check VITE_FIREBASE_API_KEY in frontend/.env.local and the Firebase web app configuration.";
  }

  switch (code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Firebase couldn't verify this email and password. If you registered with Google, choose Google sign-in; otherwise check your email and password.";
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email/password sign-in wasn't accepted. If you registered with Google, choose Google sign-in; otherwise check your email and password.";
    case "auth/email-already-in-use":
      return "This email already belongs to an account. Sign in with its existing method instead of creating another account.";
    case "auth/account-exists-with-different-credential":
      return "An account already uses this email with another sign-in method. Sign in with that method to link Google to the same account.";
    case "auth/credential-already-in-use":
      return method === "link"
        ? "This password sign-in is already linked to another NoteFlow account. Sign in to that account instead."
        : "This Google account is already linked to another NoteFlow account. Sign in to that account instead.";
    case "auth/provider-already-linked":
      return "This sign-in method is already linked to your account.";
    case "auth/requires-recent-login":
      return "For your security, sign out and sign back in before changing sign-in methods.";
    case "auth/missing-email":
      return "Enter your email address.";
    case "auth/weak-password":
      return "Choose a stronger password with at least 8 characters.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support for help.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a little while, then try again.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/unauthorized-domain":
      return "This website domain is not authorized by Firebase. Add it to Authentication → Settings → Authorized domains in Firebase Console.";
    case "auth/popup-blocked":
      return "The Google sign-in popup was blocked and redirect sign-in could not start. Check your browser settings and try again.";
    case "auth/popup-closed-by-user":
      return "The Google sign-in window was closed before authentication finished.";
    case "auth/cancelled-popup-request":
      return "Another Google sign-in window is already open. Finish or close it before trying again.";
    case "auth/network-request-failed":
      return "Firebase could not reach the network. Check your connection and try again.";
    case "auth/operation-not-supported-in-this-environment":
      return "This browser does not support the selected Google sign-in method. Try another browser or device.";
    case "auth/operation-not-allowed":
      return method === "google"
        ? "Google sign-in is disabled for this Firebase project. Enable the Google provider in Firebase Console."
        : "Email/password authentication is disabled for this Firebase project. Enable the Email/Password provider in Firebase Console.";
    case "auth/invalid-project-id":
    case "auth/project-not-found":
      return "Firebase project configuration is invalid. Check that the frontend uses project noteflowai-73991.";
    case "auth/configuration-not-found":
      return "Firebase Authentication is not configured for this project. Check the enabled sign-in providers in Firebase Console.";
    default:
      return error?.message
        ? `${action} failed: ${error.message}`
        : `${action} failed. Please try again.`;
  }
}
