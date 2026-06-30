import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
(async()=>{
  const t=(await getDocs(collection(db,"commitmentTemplates"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  t.sort((a,b)=>(a.dayOfMonth||0)-(b.dayOfMonth||0));
  console.log(`TEMPLATES (${t.length}):`);
  for(const x of t) console.log(`  d${String(x.dayOfMonth??"?").padStart(2)} | ${clp(x.amount).padStart(11)} | ${x.amountMode??"?"} | act=${x.isActive!==false?"Y":"N"} | ws=${x.workspace} | cat=${x.category} | ${x.name}`);
  const inst=(await getDocs(collection(db,"commitmentInstances"))).docs.map(d=>d.data() as any);
  const byMonth:Record<string,number>={}; for(const i of inst) byMonth[i.monthKey]=(byMonth[i.monthKey]||0)+1;
  console.log(`\nINSTANCIAS por mes:`, byMonth);
})();
