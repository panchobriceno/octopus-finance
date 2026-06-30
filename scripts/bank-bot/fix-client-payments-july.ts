import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, updateDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NEW_DATE="2026-07-05"; const NOW=new Date().toISOString();
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
(async()=>{
  const cps=(await getDocs(collection(db,"clientPayments"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const juneIncome=(await getDocs(collection(db,"transactions"))).docs.map(d=>d.data() as any).filter(t=>(t.movementType??t.type)==="income"&&String(t.date).startsWith("2026-06"));
  const targets=cps.filter(p=>p.status==="projected"&&String(p.expectedDate).startsWith("2026-06"));
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  console.log(`Mover expectedDate -> ${NEW_DATE} en ${targets.length} pagos proyectados:\n`);
  for(const p of targets){
    const match=juneIncome.find(t=>Math.abs((Number(t.amount)||0)-(Number(p.totalAmount)||0))<1);
    console.log(`  ${p.clientName.padEnd(24)} ${clp(p.totalAmount).padStart(11)}  ${p.expectedDate} -> ${NEW_DATE}  ${match?"⚠ tiene tx jun mismo monto":""}`);
    if(APPLY) await updateDoc(doc(db,"clientPayments",p.id),{expectedDate:NEW_DATE,updatedAt:NOW});
  }
  console.log(APPLY?`\n✅ ${targets.length} pagos movidos a julio.`:"\n[DRY] nada escrito.");
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
