import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, addDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const norm=(s:string)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
const KEYWORDS=["traspaso con la cuenta","desde linea de credito"];
const RULE={
  name:"Auto: transferencia interna (traspaso / línea)",
  keywords:KEYWORDS, category:"Transferencias", workspace:"business",
  movementType:"transfer", paymentMethod:"bank_account", accountId:null, creditCardName:null,
  amountDirection:"any", priority:0, isActive:true,  // priority 0 -> confianza 84 (<85) -> fuera del "convertir todo"
  notes:"Traspasos internos y giros de línea no son ingreso ni gasto. Al convertir, elegir cuenta destino.",
  createdAt:NOW, updatedAt:NOW,
};
(async()=>{
  const rules=(await getDocs(collection(db,"movementRules"))).docs.map(d=>d.data() as any);
  const exists=rules.some(r=>(r.keywords||[]).some((k:string)=>KEYWORDS.includes(norm(k))));
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  if(exists){console.log("Ya existe una regla con estas keywords; no se duplica.");return;}
  console.log(`Crear regla: "${RULE.name}"`);
  console.log(`  keywords: ${KEYWORDS.join(" | ")}`);
  console.log(`  -> categoría=${RULE.category} · movementType=${RULE.movementType} · ámbito=${RULE.workspace} · dirección=${RULE.amountDirection} · prioridad=${RULE.priority}`);
  console.log(`  efecto: marca como Transferencia (fuera de ingresos y gastos); NO auto-convierte (pide destino al confirmar)`);
  if(!APPLY){console.log("\n[DRY] nada escrito.");return;}
  const ref=await addDoc(collection(db,"movementRules"),RULE);
  console.log(`\n✅ regla creada (${ref.id})`);
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
