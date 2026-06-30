import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app"; import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
const dig=(s:any)=>String(s||"").replace(/\D/g,""); const last4=(s:any)=>dig(s).slice(-4);
const norm=(s:any)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
const get=async(c:string)=>(await getDocs(collection(db,c))).docs.map(d=>({id:d.id,...(d.data() as any)}));
(async()=>{
  const [accts,txs,ims,tpls,insts,stmts,rules,ccs]=await Promise.all(["accounts","transactions","importedMovements","commitmentTemplates","commitmentInstances","creditCardStatements","movementRules","credit_card_settings"].map(get));
  console.log("================ FASE 0 · AUDITORÍA DE IDENTIDAD DE CUENTAS ================\n");
  console.log(`Colecciones: accounts=${accts.length} transactions=${txs.length} importedMovements=${ims.length} commitmentTemplates=${tpls.length} commitmentInstances=${insts.length} creditCardStatements=${stmts.length} movementRules=${rules.length} credit_card_settings=${ccs.length}\n`);

  console.log("--- A. CUENTAS ---");
  for(const a of accts) console.log(`  ${a.id} | ${String(a.name).padEnd(34)} | banco=${a.bank||"-"} | type=${a.type} | nº=${a.accountNumber||"-"} (last4=${last4(a.accountNumber)||"-"}) | ws=${a.workspace} | ${clp(a.currentBalance)}`);
  const acctByName=new Map(accts.map(a=>[norm(a.name),a]));
  const acctByLast4=new Map(accts.filter(a=>last4(a.accountNumber)).map(a=>[last4(a.accountNumber),a]));

  console.log("\n--- B. UNIVERSO creditCardName (¿mapea a una cuenta?) ---");
  const ccNames=new Map<string,{n:number;s:number;src:Set<string>}>();
  const addCC=(v:any,amount:number,src:string)=>{const k=String(v||"").trim();if(!k||k==="-")return;const a=ccNames.get(k)??{n:0,s:0,src:new Set()};a.n++;a.s+=amount;a.src.add(src);ccNames.set(k,a);};
  for(const t of txs) if(t.creditCardName) addCC(t.creditCardName,Number(t.amount)||0,"tx");
  for(const m of ims) if(m.creditCardName) addCC(m.creditCardName,Number(m.amount)||0,"mov");
  for(const x of tpls) if(x.creditCardName) addCC(x.creditCardName,Number(x.amount)||0,"tpl");
  for(const r of rules) if(r.creditCardName) addCC(r.creditCardName,0,"rule");
  for(const [name,v] of Array.from(ccNames.entries()).sort((a,b)=>b[1].s-a[1].s)){
    const byN=acctByName.get(norm(name)); const byL=last4(name)?acctByLast4.get(last4(name)):null;
    const map=byN?`cuenta:${byN.name}`:byL?`last4→${byL.name}`:"❌ FANTASMA (sin cuenta)";
    console.log(`  "${name}" | ${v.n} usos | ${clp(v.s)} | [${[...v.src].join(",")}] | ${map}`);
  }

  console.log("\n--- C. COBERTURA accountId ---");
  const cov=(arr:any[],label:string)=>{const wi=arr.filter(x=>x.accountId).length;console.log(`  ${label}: ${wi}/${arr.length} con accountId (${arr.length-wi} sin)`);};
  cov(txs,"transactions"); cov(ims,"importedMovements"); cov(tpls,"commitmentTemplates");
  const cpNull=txs.filter(t=>t.movementType==="credit_card_payment"&&!t.accountId).length;
  const cpTot=txs.filter(t=>t.movementType==="credit_card_payment").length;
  console.log(`  pagos de tarjeta (credit_card_payment) sin accountId: ${cpNull}/${cpTot}`);

  console.log("\n--- D. ESTADOS DE CUENTA vs cuentas-tarjeta ---");
  const stLast4=new Set(stmts.map(s=>String(s.last4))); 
  for(const l of Array.from(stLast4)){ const acc=acctByLast4.get(l); const lbl=stmts.find(s=>String(s.last4)===l)?.cardLabel; console.log(`  last4 ${l} (${lbl}) | ${acc?`cuenta: ${acc.name} (${acc.type})`:"❌ sin cuenta-tarjeta"}`); }

  console.log("\n--- E. VARIANTES DE BANCO (typos/acentos) ---");
  const banks=new Map<string,number>(); for(const a of accts){const b=String(a.bank||"-");banks.set(b,(banks.get(b)||0)+1);}
  for(const [b,n] of banks) console.log(`  "${b}" (${n})`);
})();
