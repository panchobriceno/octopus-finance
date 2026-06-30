import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, updateDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const digits=(s:any)=>String(s||"").replace(/\D/g,"");
const norm=(s:any)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
// Candidatos: corridas de dígitos/separadores con >=8 dígitos. Solo se RESUELVE si matchea una cuenta conocida.
function candidates(desc:string):string[]{ const m=String(desc||"").match(/\d[\d.\-\s]{6,}\d/g)??[]; return Array.from(new Set(m.map(digits).filter(d=>d.length>=8))); }
(async()=>{
  const accts=(await getDocs(collection(db,"accounts"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const withNum=accts.filter(a=>digits(a.accountNumber).length>=6);
  const movs=(await getDocs(collection(db,"importedMovements"))).docs.map(d=>({id:d.id,...(d.data() as any)}))
    .filter(m=>m.status==="pending" && m.suggestedMovementType==="transfer" && !m.suggestedDestinationAccountId);
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  console.log(`Movimientos transferencia pendientes sin destino: ${movs.length}\n`);
  // match estricto: exacto único, o últimos 10 único; nunca substring
  function matchAcct(cands:string[]):{a:any;method:string}|null{
    const exact=Array.from(new Set(withNum.filter(a=>cands.includes(digits(a.accountNumber))).map(a=>a.id))).map(id=>withNum.find(a=>a.id===id)!);
    if(exact.length===1) return {a:exact[0],method:"exact"};
    if(exact.length>1) return null; // ambiguo
    const l10=Array.from(new Set(withNum.filter(a=>{const ad=digits(a.accountNumber);return ad.length>=10&&cands.some(c=>c.length>=10&&c.slice(-10)===ad.slice(-10));}).map(a=>a.id))).map(id=>withNum.find(a=>a.id===id)!);
    if(l10.length===1) return {a:l10[0],method:"last10"};
    return null;
  }
  let resolved=0,unresolved=0;
  for(const m of movs){
    const stmt=accts.find(a=>a.id===m.accountId);
    const cands=candidates(`${m.description} ${m.rawDescription??""}`);
    let hit=matchAcct(cands); let method=hit?.method;
    if(!hit && /linea de credito/.test(norm(m.description)) && stmt){
      const line=accts.find(a=>a.type==="credit_line" && a.bank===stmt.bank && a.id!==stmt.id);
      if(line){ hit={a:line,method:"same-bank-line"}; method="same-bank-line"; }
    }
    if(!hit){ console.log(`  ✗ "${String(m.description).slice(0,42)}" [${m.direction}] cands=${cands.join(",")||"-"} -> sin match (queda manual)`); unresolved++; continue; }
    if(!stmt){ console.log(`  ✗ "${String(m.description).slice(0,42)}" -> sin cuenta de extracto (accountId)`); unresolved++; continue; }
    const counter=hit.a;
    if(counter.id===stmt.id){ console.log(`  ✗ "${String(m.description).slice(0,42)}" -> contraparte == cuenta del extracto; skip`); unresolved++; continue; }
    const inc=m.direction==="income";
    const source=inc?counter:stmt, dest=inc?stmt:counter;
    const patch:any={ suggestedSourceAccountId:source.id, suggestedWorkspace:source.workspace, suggestedDestinationAccountId:dest.id, suggestedDestinationWorkspace:dest.workspace, updatedAt:NOW };
    if(method==="exact") patch.confidence=Math.max(Number(m.confidence)||0,85); // 85 solo para match exacto de número
    console.log(`  ✓ "${String(m.description).slice(0,42)}" [${m.direction}] (${method}) → ${source.name} → ${dest.name}${patch.confidence?` conf=${patch.confidence}`:""}`);
    if(APPLY) await updateDoc(doc(db,"importedMovements",m.id),patch);
    resolved++;
  }
  console.log(`\n${APPLY?"✅":"[DRY]"} resueltos ${resolved} | sin match ${unresolved}`);
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
