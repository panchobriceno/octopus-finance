import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
(async()=>{
  const cps=(await getDocs(collection(db,"clientPayments"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  console.log(`=== clientPayments (${cps.length}) ===`);
  for(const p of cps.sort((a,b)=>String(a.expectedDate).localeCompare(String(b.expectedDate)))){
    console.log(`  ${p.clientName} | ${clp(p.totalAmount)} | svcMonth=${p.serviceMonth} exp=${p.expectedDate} pay=${p.paymentDate??"-"} | status=${p.status} | matchedTx=${p.matchedTransactionId??"-"}`);
  }
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>d.data() as any).filter(t=>(t.movementType??t.type)==="income");
  console.log(`\n=== transacciones income (${txs.length}) por mes ===`);
  const bm:Record<string,{n:number;s:number}>={}; for(const t of txs){const k=String(t.date).slice(0,7);bm[k]=bm[k]||{n:0,s:0};bm[k].n++;bm[k].s+=Number(t.amount)||0;}
  for(const k of Object.keys(bm).sort()) console.log(`  ${k}: ${bm[k].n} tx, ${clp(bm[k].s)}`);
})();
