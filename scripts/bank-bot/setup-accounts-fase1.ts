import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, updateDoc, addDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const digits=(s:string)=>String(s||"").replace(/\D/g,"");
// Cuentas existentes -> número (por id, verificando nombre)
const SET_NUMBER:{id:string;name:string;number:string}[]=[
  {id:"2Bx9eSqmlGJaBLw5RBTy",name:"Cuenta Corriente Edwards Pancho",number:"00-310-10777-06"},
  {id:"asIrUoWJkN1jH2zzJhT0",name:"Cuenta Corriente OM",number:"73873991"},
  {id:"36WevzgCYGVlb0YpWFdU",name:"Cuenta corriente Itaú Javi",number:"0209792118"},
];
// Líneas nuevas -> hereda banco de la cuenta hermana (para match same-bank en Fase 2)
const NEW_LINES:{name:string;number:string;workspace:string;isShared:boolean;siblingId:string}[]=[
  {name:"Línea de Crédito Edwards Pancho",number:"01-310-10777-07",workspace:"family",isShared:false,siblingId:"2Bx9eSqmlGJaBLw5RBTy"},
  {name:"Línea de Crédito Santander OM",number:"0-020-0240940-5",workspace:"shared",isShared:true,siblingId:"asIrUoWJkN1jH2zzJhT0"},
  {name:"Línea de Crédito Itaú Javi",number:"0209840823",workspace:"family",isShared:false,siblingId:"36WevzgCYGVlb0YpWFdU"},
];
(async()=>{
  const snap=await getDocs(collection(db,"accounts"));
  const accts=snap.docs.map(d=>({id:d.id,...(d.data() as any)}));
  const byId=new Map(accts.map(a=>[a.id,a]));
  const numExists=(n:string)=>accts.some(a=>digits(a.accountNumber)===digits(n)&&digits(n).length>0);
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  // Backup
  if(APPLY){const bp=path.join(process.cwd(),"scripts","bank-bot",`_backup-accounts-${NOW.replace(/[:.]/g,"-")}.json`);fs.writeFileSync(bp,JSON.stringify(accts,null,2));console.log(`Backup: ${bp}`);}
  // 1) Números en existentes
  console.log("\n--- NÚMEROS EN CUENTAS EXISTENTES ---");
  for(const s of SET_NUMBER){ const a=byId.get(s.id);
    if(!a){console.log(`  ⚠ ${s.name}: id no existe (${s.id}); SKIP`);continue;}
    if(a.name!==s.name){console.log(`  ⚠ ${s.id}: nombre real "${a.name}" != "${s.name}"; SKIP por seguridad`);continue;}
    console.log(`  ${a.name}: accountNumber="${a.accountNumber??"(vacío)"}" -> "${s.number}" (dígitos ${digits(s.number)})`);
    if(APPLY) await updateDoc(doc(db,"accounts",s.id),{accountNumber:s.number,updatedAt:NOW});
  }
  // 2) Crear líneas (idempotente por número)
  console.log("\n--- CREAR LÍNEAS DE CRÉDITO ---");
  for(const l of NEW_LINES){
    if(numExists(l.number)){console.log(`  (ya existe cuenta con número ${l.number}; SKIP) ${l.name}`);continue;}
    const sib=byId.get(l.siblingId); const bank=sib?.bank??"";
    console.log(`  + ${l.name} | banco="${bank}" | type=credit_line | nº ${l.number} | ws=${l.workspace}${l.isShared?" (shared)":""}`);
    if(APPLY){ await addDoc(collection(db,"accounts"),{name:l.name,bank,type:"credit_line",accountNumber:l.number,currentBalance:0,currency:"CLP",workspace:l.workspace,isShared:l.isShared,notes:null,updatedAt:NOW}); }
  }
  console.log(APPLY?"\n✅ Fase 1 aplicada.":"\n[DRY] nada escrito.");
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
