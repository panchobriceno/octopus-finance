import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, updateDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const SANTANDER_OM="asIrUoWJkN1jH2zzJhT0"; const MONTHS=["2026-07","2026-08"];
function clampDay(y:number,m:number,d:number){const dim=new Date(y,m,0).getDate();return Math.min(Math.max(d,1),dim);}
function dueDate(mk:string,dom:number){const [y,m]=mk.split("-").map(Number);const d=clampDay(y,m,dom);return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function only(t:any[],n:string){const m=t.filter(x=>x.name===n);if(m.length!==1)throw new Error(`Esperaba 1 "${n}", hay ${m.length}`);return m[0];}
(async()=>{
  const tpls=(await getDocs(collection(db,"commitmentTemplates"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const inst=(await getDocs(collection(db,"commitmentInstances"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>d.data() as any);
  const acctOk=txs.some(t=>t.accountId===SANTANDER_OM);
  const upd:{name:string;day?:number;extra?:any}[]=[
    {name:"Gas",day:10},{name:"Luz",day:6},{name:"Internet Hogar",day:8},{name:"Agua",day:10},
    {name:"Celular Pancho",extra: acctOk?{accountId:SANTANDER_OM,paymentMethod:"bank_account"}:undefined},
  ];
  if(!acctOk) console.log(`⚠ accountId Santander OM (${SANTANDER_OM}) no aparece en transacciones; NO seteo cuenta en Celular Pancho.`);
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  const instById=new Map(inst.map(i=>[i.id,i]));
  for(const u of upd){
    const t=only(tpls,u.name);
    const tPatch:any={...(u.day?{dayOfMonth:u.day}:{}),...(u.extra||{}),updatedAt:NOW};
    if(Object.keys(tPatch).length<=1){console.log(`  SKIP ${u.name} (nada que cambiar)`);continue;}
    console.log(`  TEMPLATE ${u.name}: ${u.day?`d${t.dayOfMonth}->d${u.day}`:""} ${u.extra?JSON.stringify(u.extra):""}`);
    if(APPLY) await updateDoc(doc(db,"commitmentTemplates",t.id),tPatch);
    for(const mk of MONTHS){ const iid=`${t.id}::${mk}`; const ex=instById.get(iid); if(!ex){console.log(`    (sin instancia ${mk})`);continue;}
      const iPatch:any={...(u.day?{dueDate:dueDate(mk,u.day)}:{}),...(u.extra||{}),updatedAt:NOW};
      console.log(`    INST ${mk}: ${u.day?`due ${ex.dueDate}->${dueDate(mk,u.day)}`:""} ${u.extra?"+cuenta":""}`);
      if(APPLY) await updateDoc(doc(db,"commitmentInstances",iid),iPatch);
    }
  }
  console.log(APPLY?"\n✅ aplicado.":"\n[DRY] nada escrito.");
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
