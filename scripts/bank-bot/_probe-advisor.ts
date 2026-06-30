import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function loadEnv(fp: string){ if(!fs.existsSync(fp))return; for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
loadEnv(path.join(process.cwd(),".env.local")); loadEnv(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
(async()=>{
  const cards=(await getDocs(collection(db,"credit_card_settings"))).docs.map(d=>d.data() as any);
  console.log("=== credit_card_settings (cardName) ==="); for(const c of cards) console.log(`  "${c.cardName}" active=${c.isActive}`);
  const batches=(await getDocs(collection(db,"importBatches"))).docs.map(d=>d.data() as any);
  const eecc=batches.filter(b=>{const s=`${b.source??""} ${b.sourceName??""} ${b.notes??""}`.toLowerCase();return b.sourceType==="credit_card"&&(s.includes("eecc")||s.includes("estado")||b.source==="pdf");});
  console.log(`\n=== importBatches tipo EECC: ${eecc.length} ===`); for(const b of eecc) console.log(`  card="${b.creditCardName}" source=${b.source} periodEnd=${b.periodEnd} created=${b.createdAt?.slice(0,10)}`);
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>d.data() as any);
  const prev=txs.filter(t=>/previred/i.test(t.name??"")||/previred/i.test(t.category??""));
  console.log(`\n=== transacciones PREVIRED: ${prev.length} ===`); for(const t of prev) console.log(`  ${t.date} $${Number(t.amount).toLocaleString("es-CL")} "${t.name}" cat=${t.category}`);
  const movs=(await getDocs(collection(db,"importedMovements"))).docs.map(d=>d.data() as any).filter(m=>/previred/i.test(m.description??""));
  console.log(`\n=== movimientos PREVIRED en bandeja: ${movs.length} ===`); for(const m of movs) console.log(`  [${m.status}] ${m.date} $${Number(m.amount).toLocaleString("es-CL")} "${m.description}" cat=${m.suggestedCategory}`);
})();
