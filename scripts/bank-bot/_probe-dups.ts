import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
(async()=>{
  const ims=(await getDocs(collection(db,"importedMovements"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const byStatus:Record<string,number>={}; for(const m of ims) byStatus[m.status??"?"]=(byStatus[m.status??"?"]||0)+1;
  console.log("importedMovements por status:",byStatus);
  const dups=ims.filter(m=>m.status==="duplicate");
  console.log(`\nduplicate (${dups.length}) — campos de match:`);
  const fields=new Set<string>(); dups.forEach(m=>Object.keys(m).forEach(k=>fields.add(k)));
  console.log("  campos presentes:",[...fields].filter(f=>/match|dup|dedupe|status|reason|conflict/i.test(f)).join(", "));
  dups.slice(0,6).forEach(m=>console.log(`  - "${String(m.description).slice(0,32)}" $${m.amount} matchedTx=${m.matchedTransactionId??"-"} dupOf=${m.duplicateOfId??m.duplicateOf??"-"} reason=${m.duplicateReason??m.conflictReason??"-"}`));
})();
