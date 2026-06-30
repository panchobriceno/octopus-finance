import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, updateDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
const CARD_NAME="T.C Edwards Pancho"; const CARD_LAST4="****7232";
type Change={collection:string;id:string;before:any;after:any};
(async()=>{
  const accts=(await getDocs(collection(db,"accounts"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const txs=(await getDocs(collection(db,"transactions"))).docs.map(d=>({id:d.id,...(d.data() as any)}));
  const changes:Change[]=[];
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");

  // 1) accountNumber (last4) en la cuenta de tarjeta T.C Edwards Pancho
  const cardAccts=accts.filter(a=>a.type==="credit_card" && a.name===CARD_NAME);
  if(cardAccts.length!==1) throw new Error(`Esperaba 1 cuenta de tarjeta "${CARD_NAME}", hay ${cardAccts.length}`);
  const ca=cardAccts[0];
  const curNum=String(ca.accountNumber??"");
  if(curNum && curNum.replace(/\D/g,"").slice(-4)!=="7232") throw new Error(`"${CARD_NAME}" ya tiene accountNumber "${curNum}" en conflicto; abort`);
  if(curNum.replace(/\D/g,"").slice(-4)==="7232"){ console.log(`  · ${CARD_NAME}: accountNumber ya tiene 7232 (no-op)`); }
  else { changes.push({collection:"accounts",id:ca.id,before:{accountNumber:ca.accountNumber??null},after:{accountNumber:CARD_LAST4}}); console.log(`  ✓ ${CARD_NAME}: accountNumber -> ${CARD_LAST4}`); }

  // 2) Ligar el pago de $1.520.000 (23/06) a la tarjeta Edwards
  const cands=txs.filter(t=>t.movementType==="credit_card_payment" && Math.round(Number(t.amount))===1520000 && String(t.date)==="2026-06-23");
  if(cands.length!==1) throw new Error(`Esperaba 1 pago de $1.520.000 el 2026-06-23, hay ${cands.length}; abort`);
  const p=cands[0]; const cc=String(p.creditCardName??"").trim();
  if(cc===CARD_NAME){ console.log(`  · pago $1.520.000: ya ligado a ${CARD_NAME} (no-op)`); }
  else if(cc && cc!=="-"){ throw new Error(`pago $1.520.000 ya ligado a "${cc}"; abort`); }
  else { changes.push({collection:"transactions",id:p.id,before:{creditCardName:p.creditCardName??null},after:{creditCardName:CARD_NAME}}); console.log(`  ✓ pago $1.520.000 (${p.date}) -> ligado a ${CARD_NAME}`); }

  if(!changes.length){ console.log("\nNada que cambiar."); return; }
  if(!APPLY){ console.log(`\n[DRY] ${changes.length} cambios. Nada escrito.`); return; }
  const bp=path.join(process.cwd(),"scripts","bank-bot",`_backup-link-${NOW.replace(/[:.]/g,"-")}.json`);
  fs.writeFileSync(bp,JSON.stringify(changes,null,2)); console.log(`Backup restaurable: ${bp}`);
  for(const c of changes) await updateDoc(doc(db,c.collection,c.id),{...c.after,updatedAt:NOW});
  console.log(`\n✅ ${changes.length} cambios aplicados.`);
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
