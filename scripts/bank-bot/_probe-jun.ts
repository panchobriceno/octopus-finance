import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
(async()=>{
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>d.data() as any);
  const inc=txs.filter(t=>t.type==="income"&&t.subtype==="actual"&&t.status==="paid"&&!t.sourceClientPaymentId&&String(t.date).startsWith("2026-06")).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  let s=0; for(const t of inc){s+=Number(t.amount)||0; console.log(`  ${t.date} ${clp(t.amount).padStart(11)}  ${t.workspace} | ${t.category} | ${String(t.name).slice(0,44)}`);}
  console.log(`\n  TOTAL (${inc.length} tx): ${clp(s)}`);
})();
