import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";

declare global {
  interface Window {
    __APP_CONFIG__?: {
      VITE_FIREBASE_API_KEY?: string;
      VITE_FIREBASE_AUTH_DOMAIN?: string;
      VITE_FIREBASE_PROJECT_ID?: string;
      VITE_FIREBASE_STORAGE_BUCKET?: string;
      VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
      VITE_FIREBASE_APP_ID?: string;
    };
  }
}

const runtimeConfig = window.__APP_CONFIG__ ?? {};

const firebaseConfig = {
  apiKey: runtimeConfig.VITE_FIREBASE_API_KEY || import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: runtimeConfig.VITE_FIREBASE_AUTH_DOMAIN || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: runtimeConfig.VITE_FIREBASE_PROJECT_ID || import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: runtimeConfig.VITE_FIREBASE_STORAGE_BUCKET || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    runtimeConfig.VITE_FIREBASE_MESSAGING_SENDER_ID || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: runtimeConfig.VITE_FIREBASE_APP_ID || import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// Use Firestore Lite SDK — no offline persistence, no IndexedDB
// Reduces bundle size significantly and avoids sandboxed iframe issues
export const db = getFirestore(app);
