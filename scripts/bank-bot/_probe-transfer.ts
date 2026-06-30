import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
(async()=>{
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const tr=txs.filter(t=>t.movementType==="transfer");
  console.log(`transferencias existentes (${tr.length}):`);
  tr.slice(0,3).forEach(t=>console.log(`  type=${t.type} movementType=${t.movementType} category=${t.category} destWs=${t.destinationWorkspace} destAcct=${t.destinationAccountId} | ${String(t.name).slice(0,30)}`));
  // los 3 a reclasificar
  console.log("\nlos 3 a reclasificar:");
  const targets=txs.filter(t=>String(t.date).startsWith("2026-06")&&t.type==="income"&&(/Traspaso con la Cuenta|Linea De Credito/i.test(String(t.name))));
  targets.forEach(t=>console.log(`  ${t.id} | type=${t.type} mt=${t.movementType} cat=${t.category} | $${t.amount} | ${String(t.name).slice(0,40)}`));
})();
