/**
 * Helper compartido de Firestore AUTENTICADO para los scripts (post-cierre de reglas).
 * La SA (admin) firma un custom token para el UID dueño → el CLIENT SDK inicia sesión con él →
 * devuelve un getFirestore(app) ya autenticado. Así los scripts conservan la API client
 * (collection/getDocs/setDoc/writeBatch) y pasan las reglas (request.auth.uid).
 * La apiKey web es pública; la SA es secreta (~/.claude-secrets, chmod 600).
 */
import { initializeApp as initAdmin, cert, getApps as getAdminApps } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import fs from "node:fs";

const SA_PATH = process.env.FIREBASE_ADMIN_KEY || `${process.env.HOME}/.claude-secrets/my-cash-flow-firebase-admin.json`;
const OWNER_UID = process.env.FIREBASE_OWNER_UID || "AKgiLAeRImfeGKg1N18MxmgV28q2"; // francisco@octopusmedia.cl

const WEB_CONFIG = {
  apiKey: "AIzaSyBmqJF7jsGnf_IW7WDUItbFtxcuYNWCpx4",
  authDomain: "my-cash-flow-bcb24.firebaseapp.com",
  projectId: "my-cash-flow-bcb24",
  storageBucket: "my-cash-flow-bcb24.firebasestorage.app",
  messagingSenderId: "660839296094",
  appId: "1:660839296094:f0e9e5bd5a9518cf",
};

/** Devuelve un Firestore (client lite) ya autenticado como el usuario dueño. Llamar 1 vez por script. */
export async function getAuthedDb() {
  if (!getAdminApps().length) {
    if (!fs.existsSync(SA_PATH)) throw new Error(`Falta la SA key en ${SA_PATH}`);
    initAdmin({ credential: cert(JSON.parse(fs.readFileSync(SA_PATH, "utf8"))) });
  }
  const token = await getAdminAuth().createCustomToken(OWNER_UID);
  const app = initializeApp(WEB_CONFIG, `authed-${Date.now()}`);
  await signInWithCustomToken(getAuth(app), token);
  return getFirestore(app);
}
