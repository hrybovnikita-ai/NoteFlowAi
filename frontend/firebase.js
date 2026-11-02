import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getRedirectResult,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  setPersistence,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfigKeys = [
  ["VITE_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["VITE_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["VITE_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["VITE_FIREBASE_APP_ID", firebaseConfig.appId],
];

const expectedProjectId = "noteflowai-73991";
const defaultApp = getApps().find(({ name }) => name === "[DEFAULT]");
export const firebaseConfigError = requiredConfigKeys
  .filter(([, value]) => !value?.trim())
  .map(([name]) => name);
if (
  firebaseConfig.projectId
  && !import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST
  && firebaseConfig.projectId !== expectedProjectId
) {
  firebaseConfigError.push(`VITE_FIREBASE_PROJECT_ID must be ${expectedProjectId}`);
}
if (defaultApp && defaultApp.options.projectId !== firebaseConfig.projectId) {
  firebaseConfigError.push("The existing Firebase app is initialized for a different project");
}

const app = firebaseConfigError.length
  ? null
  : defaultApp
    ? getApp()
    : initializeApp(firebaseConfig);

export const auth = app ? getAuth(app) : null;
if (auth && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST) {
  connectAuthEmulator(auth, `http://${import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
}
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
export {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  linkWithCredential,
  onAuthStateChanged,
  setPersistence,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
};
export const emailCredential = EmailAuthProvider.credential;
export const googleCredentialFromError = GoogleAuthProvider.credentialFromError;