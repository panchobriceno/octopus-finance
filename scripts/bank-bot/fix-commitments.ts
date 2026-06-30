import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, setDoc, deleteDoc, updateDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT_PROJECT="my-cash-flow-bcb24";
if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT_PROJECT){console.error(`ABORT: projectId inesperado (${process.env.VITE_FIREBASE_PROJECT_ID})`);process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
function clampDay(y:number,m:number,d:number){const dim=new Date(y,m,0).getDate();return Math.min(Math.max(d,1),dim);}
function dueDate(mk:string,dom:number){const [y,m]=mk.split("-").map(Number);const d=clampDay(y,m,dom);return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
const identity=(tid:string,mk:string)=>`${tid}::${mk}`;
const MONTHS=["2026-07","2026-08"];
// Espera EXACTAMENTE 1 template con ese name; aborta si 0 o 2+ (fail-closed).
function only(tpls:any[],name:string){const m=tpls.filter(x=>x.name===name);if(m.length!==1)throw new Error(`Esperaba 1 template "${name}", encontré ${m.length}`);return m[0];}
(async()=>{
  let tpls=(await getDocs(collection(db,"commitmentTemplates"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const allInst=(await getDocs(collection(db,"commitmentInstances"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (usá --apply para escribir) ===");

  // 1) Correcciones (matching estricto)
  const updates:{name:string;day?:number;extra?:any}[]=[
    {name:"Previred",day:12},{name:"IVA",day:20,extra:{amountMode:"variable"}},
    {name:"Pago a Contador",day:25},{name:"Dividendo",day:8},{name:"Pago Arriendo Javi",day:18},
  ];
  console.log("\n--- CORRECCIONES ---");
  const toUpdate:{id:string;patch:any;label:string}[]=[];
  for(const u of updates){ const t=only(tpls,u.name);
    const patch:any={...(u.day?{dayOfMonth:u.day}:{}),...(u.extra||{}),updatedAt:NOW};
    console.log(`  UPDATE ${t.name}: d${t.dayOfMonth}->d${u.day??t.dayOfMonth} ${u.extra?JSON.stringify(u.extra):""}`);
    toUpdate.push({id:t.id,patch,label:t.name});
  }

  // 2) Borrar Contador duplicado (d19) con guardas
  const dups=tpls.filter(x=>x.name==="Contador" && Number(x.dayOfMonth)===19);
  if(dups.length!==1) throw new Error(`Esperaba 1 "Contador" d19, encontré ${dups.length}`);
  const dup=dups[0];
  if(Number(dup.amount)!==40000 || dup.workspace!=="business") throw new Error(`"Contador" d19 no calza (amount=${dup.amount} ws=${dup.workspace}); no borro por seguridad`);
  const dupInst=allInst.filter(i=>i.templateId===dup.id);
  const locked=dupInst.filter(i=>i.status==="paid"||i.matchedTransactionId||i.paidAt);
  if(locked.length) throw new Error(`El duplicado tiene ${locked.length} instancias pagadas/conciliadas; NO borro`);
  const refTx=txs.filter(t=>t.sourceCommitmentTemplateId===dup.id || dupInst.some(di=>di.id===t.sourceCommitmentInstanceId));
  if(refTx.length) throw new Error(`Hay ${refTx.length} transacciones que referencian el duplicado; NO borro`);
  console.log(`\n--- DUPLICADO ---\n  DELETE "${dup.name}" d19 ${clp(dup.amount)} (${dup.id}) + ${dupInst.length} instancias (ninguna pagada/referenciada)`);

  // 3) Generar instancias julio/agosto (ID determinístico, idempotente)
  const haveIds=new Set(allInst.map(i=>i.id));
  const effTpls=tpls.filter(x=>x.id!==dup.id).map(t=>{const u=updates.find(x=>x.name===t.name); if(u){return {...t,...(u.day?{dayOfMonth:u.day}:{}),...(u.extra||{})};} return t;});
  console.log("\n--- GENERAR INSTANCIAS ---");
  const toCreate:{id:string;inst:any}[]=[];
  for(const mk of MONTHS){ for(const t of effTpls.filter(x=>x.isActive!==false)){
    const id=identity(t.id,mk); if(haveIds.has(id)) continue;
    toCreate.push({id,inst:{templateId:t.id,monthKey:mk,name:t.name,category:t.category,expectedAmount:Number(t.amount)||0,amountMode:t.amountMode??"fixed",dueDate:dueDate(mk,Number(t.dayOfMonth)||1),workspace:t.workspace??"family",movementType:t.movementType??"expense",paymentMethod:t.paymentMethod??"bank_account",accountId:t.accountId??null,destinationAccountId:t.destinationAccountId??null,creditCardName:t.creditCardName??null,status:"pending",matchedTransactionId:null,matchedAt:null,paidAt:null,notes:t.notes??null,createdAt:NOW,updatedAt:NOW}});
  }}
  console.log(`  ${toCreate.length} instancias a crear (julio+agosto)`);

  if(!APPLY){ console.log("\n[DRY] nada escrito. Corré con --apply para aplicar."); return; }
  // Escribir: updates -> borrar dup (instancias + template) -> generar (IDs determinísticos)
  for(const u of toUpdate) await updateDoc(doc(db,"commitmentTemplates",u.id),u.patch);
  for(const di of dupInst) await deleteDoc(doc(db,"commitmentInstances",di.id));
  await deleteDoc(doc(db,"commitmentTemplates",dup.id));
  for(const c of toCreate) await setDoc(doc(db,"commitmentInstances",c.id),c.inst);
  console.log(`\n✅ ${toUpdate.length} correcciones, 1 duplicado borrado (+${dupInst.length} inst), ${toCreate.length} instancias creadas.`);
})().catch(e=>{console.error("\n❌ ABORTADO:",e.message);process.exit(1);});
