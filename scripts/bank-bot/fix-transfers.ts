import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, updateDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const IDS=["EtcnFIhqvSsKPh0x8XzK","k7nQJYfDcXFvoTcWmojW","v1V5S7vyRHAN1p5vM0do"];
const RE=/Traspaso con la Cuenta|Linea De Credito/i;
(async()=>{
  const all=new Map((await getDocs(collection(db,"transactions"))).docs.map(d=>[d.id,d.data() as any]));
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  let n=0;
  for(const id of IDS){ const t=all.get(id);
    if(!t){console.log(`  ⚠ ${id} no existe`);continue;}
    if(t.type!=="income"||!RE.test(String(t.name))){console.log(`  ⚠ ${id} no calza (type=${t.type} name="${t.name}"); SKIP`);continue;}
    console.log(`  ${id} $${t.amount} "${String(t.name).slice(0,34)}": income/Otros Ingresos -> transfer/Transferencias`);
    if(APPLY) await updateDoc(doc(db,"transactions",id),{type:"expense",movementType:"transfer",category:"Transferencias",updatedAt:NOW});
    n++;
  }
  console.log(APPLY?`\n✅ ${n} reclasificados. Ingresos junio: $4.065.183 -> $3.981.170`:"\n[DRY] nada escrito.");
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
