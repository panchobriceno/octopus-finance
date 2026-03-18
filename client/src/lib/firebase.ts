import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";

const firebaseConfig = {
  apiKey: "AIzaSyDFkNHHxpcRNB_2n_JaDJxD0sCI_cY2skA",
  authDomain: "my-cash-flow-bcb24.firebaseapp.com",
  projectId: "my-cash-flow-bcb24",
  storageBucket: "my-cash-flow-bcb24.firebasestorage.app",
  messagingSenderId: "660839296094",
  appId: "1:660839296094:f0e9e5bd5a9518cf",
};

const app = initializeApp(firebaseConfig);

// Use Firestore Lite SDK — no offline persistence, no IndexedDB
// Reduces bundle size significantly and avoids sandboxed iframe issues
export const db = getFirestore(app);
