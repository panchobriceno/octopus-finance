import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function loadEnv(fp: string){ if(!fs.existsSync(fp))return; for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
loadEnv(path.join(process.cwd(),".env.local")); loadEnv(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
(async()=>{
  const MK="2026-06";
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>d.data() as any).filter(t=>(t.status??"paid")!=="cancelled");
  const incomeTx=txs.filter(t=>(t.movementType??t.type)==="income" && String(t.date).startsWith(MK));
  console.log(`=== TRANSACCIONES de ingreso en ${MK}: ${incomeTx.length} ===`);
  let s1=0; for(const t of incomeTx){ s1+=Number(t.amount)||0; console.log(`  ${t.date} ${clp(t.amount)} "${t.name}" cat=${t.category} ws=${t.workspace}`); }
  console.log(`  SUMA transacciones ingreso: ${clp(s1)}`);
  const cps=(await getDocs(collection(db,"clientPayments"))).docs.map(d=>d.data() as any);
  const cpJun=cps.filter(p=>{const d=p.expectedDate||p.dueDate||p.paymentDate||"";return String(d).startsWith(MK);});
  console.log(`\n=== PAGOS DE CLIENTE con fecha en ${MK}: ${cpJun.length} ===`);
  let s2=0; for(const p of cpJun){ s2+=Number(p.totalAmount)||0; console.log(`  ${p.expectedDate||p.dueDate} ${clp(p.totalAmount)} "${p.clientName}" status=${p.status}`); }
  console.log(`  SUMA pagos cliente (jun): ${clp(s2)}`);
  console.log(`\n=== TOTAL si se suman ambos: ${clp(s1+s2)} ===`);
})();
