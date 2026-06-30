import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, setDoc, deleteDoc } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const EXPECT="my-cash-flow-bcb24"; if(process.env.VITE_FIREBASE_PROJECT_ID!==EXPECT){console.error("ABORT projectId");process.exit(1);}
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
const APPLY=process.argv.includes("--apply"); const NOW=new Date().toISOString();
const FOLDER=process.argv.slice(2).find(a=>a.startsWith("/")) || "/Users/panchobriceno/Downloads/Apps OM/cartolas-banco-para-om-finance";
const PASSWORDS=["1822","8374",""]; const CLAUDE_BIN=process.env.CLAUDE_BIN||"claude";
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
const digits=(s:any)=>String(s||"").replace(/\D/g,"");
const norm=(s:any)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
function bankCode(bank:any):string{const b=norm(bank);if(b.includes("edwards")||b.includes("chile"))return "bancochile";if(b.includes("santander"))return "santander";if(b.includes("itau"))return "itau";if(b.includes("bci"))return "bci";if(b.includes("estado"))return "bancoestado";if(b.includes("scotia"))return "scotiabank";if(b.includes("falabella"))return "falabella";return b.replace(/\s+/g,"").slice(0,14)||"banco";}
// Banco DETERMINÍSTICO desde el texto del EECC (la IA a veces alucina el banco).
function detectBank(text:string):string{const t=norm(text);if(t.includes("santander"))return "Banco Santander";if(t.includes("itau"))return "Itaú";if(t.includes("edwards"))return "Banco Edwards";if(t.includes("banco de chile"))return "Banco de Chile";if(t.includes("scotia"))return "Scotiabank";if(t.includes("falabella"))return "Banco Falabella";if(t.includes("bci"))return "BCI";if(t.includes("bancoestado")||t.includes("banco estado"))return "BancoEstado";return "";}
function pdfText(file:string,pw:string):string{ try{ return execFileSync("/opt/homebrew/bin/pdftotext",["-layout","-upw",pw,file,"-"],{encoding:"utf8",timeout:30000,maxBuffer:32*1024*1024}); }catch{ return ""; } }
function decrypt(file:string):{text:string;pw:string}|null{
  for(const pw of PASSWORDS){ const t=pdfText(file,pw);
    // sanity: texto suficiente + anclas de cartola
    if(t.length>400 && /(pagar hasta|facturado a pagar|total a pagar)/i.test(t) && /(cupo|tarjeta de cr)/i.test(t)) return {text:t,pw};
  } return null;
}
function callClaude(prompt:string):string|null{ try{ const out=execFileSync(CLAUDE_BIN,["-p","--output-format","json","--max-turns","1"],{input:prompt,encoding:"utf8",timeout:180000,maxBuffer:16*1024*1024}); try{const e=JSON.parse(out);if(e&&typeof e.result==="string")return e.result;}catch{} return out; }catch(e:any){console.error("IA no disp:",e?.message);return null;} }
function parseObj(t:string):any|null{ const i=t.indexOf("{"); if(i===-1)return null; for(let j=t.length;j>i;j--){ const s=t.slice(i,j); if(s.trim().endsWith("}")){ try{return JSON.parse(s);}catch{} } } return null; }
const PROMPT=`Sos un extractor del RESUMEN de un estado de cuenta (EECC) de tarjeta de crédito chileno. Te doy el TEXTO crudo. Devolvé SOLO un objeto JSON con el resumen del PERÍODO ACTUAL (NUNCA del "PERÍODO ANTERIOR"):
{"bank":"<Banco Edwards|Banco Santander|Itaú|...>","holder":"<titular>","last4":"<4 dígitos>","periodStart":"YYYY-MM-DD","periodEnd":"YYYY-MM-DD","pagarHasta":"YYYY-MM-DD","montoFacturado":<entero CLP del MONTO TOTAL FACTURADO A PAGAR nacional del período ACTUAL, o 0 si el EECC es SOLO internacional>,"montoFacturadoRawLine":"<la línea textual EXACTA de donde sale montoFacturado, o vacío si no hay nacional>","montoMinimo":<entero|null>,"cupoTotal":<entero|null>,"cupoUtilizado":<entero|null>,"cupoDisponible":<entero|null>,"deudaInternacionalUsd":<número|0>}
IMPORTANTE deudaInternacionalUsd: si el EECC tiene una sección "ESTADO DE CUENTA INTERNACIONAL" o cargos en US$, devolvé ahí el monto de "DEUDA TOTAL" en US$ del período actual (NO el saldo anterior, NO traspasos). Muchos EECC traen nacional E internacional en el MISMO documento. Si no hay deuda internacional, 0.
REGLAS: montos CLP como enteros sin puntos. El monto es del período ACTUAL, jamás de "período anterior"/"saldo anterior"/"monto cancelado"/"pago"/"abono". Si falta un dato, null.`;
(async()=>{
  const files=fs.readdirSync(FOLDER).filter(f=>f.toLowerCase().endsWith(".pdf")).map(f=>path.join(FOLDER,f));
  const existing=new Map((await getDocs(collection(db,"creditCardStatements"))).docs.map(d=>[d.id,d.data() as any]));
  console.log(APPLY?"=== APLICANDO ===":"=== DRY (--apply para escribir) ===");
  if(APPLY){const bp=path.join(process.cwd(),"scripts","bank-bot",`_backup-statements-${NOW.replace(/[:.]/g,"-")}.json`);fs.writeFileSync(bp,JSON.stringify([...existing.values()],null,2));console.log(`Backup: ${bp}`);}
  // --reset: borra las docs existentes (p.ej. ids viejos con titular) antes de recargar limpio
  if(process.argv.includes("--reset")){
    console.log(`${APPLY?"Borrando":"[DRY] borraría"} ${existing.size} estados existentes...`);
    if(APPLY){ for(const id of Array.from(existing.keys())) await deleteDoc(doc(db,"creditCardStatements",id)); existing.clear(); }
  }
  console.log(`Carpeta: ${FOLDER} — ${files.length} PDFs\n`);
  // Incremental: saltar PDFs ya procesados (mismo hash) para no re-llamar a la IA cada día.
  const FORCE=process.argv.includes("--reset")||process.argv.includes("--force");
  const knownHashes=new Set(Array.from(existing.values()).map((s:any)=>s.sourceFileHash).filter(Boolean));
  const seen=new Map<string,any>(); let ok=0,skip=0,conflict=0,unchanged=0;
  for(const file of files){
    const name=path.basename(file);
    const fileHash=crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0,16);
    if(!FORCE && knownHashes.has(fileHash)){ unchanged++; continue; } // ya cargado, sin cambios
    const dec=decrypt(file);
    if(!dec){ console.log(`  ✗ ${name}: no descifra/no parece cartola`); skip++; continue; }
    const raw=callClaude(`${PROMPT}\n\nTEXTO:\n${dec.text.slice(0,50000)}`);
    const o=raw?parseObj(raw):null;
    if(!o){ console.log(`  ✗ ${name}: IA sin JSON`); skip++; continue; }
    // validaciones
    const last4=digits(o.last4).slice(-4);
    const monto=Math.round(Number(o.montoFacturado)||0);
    const usd=o.deudaInternacionalUsd!=null?Math.max(0,Number(o.deudaInternacionalUsd)):0;
    if(!/^\d{4}$/.test(last4) || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.periodEnd)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.pagarHasta))){ console.log(`  ✗ ${name}: campos clave inválidos (last4=${o.last4} periodEnd=${o.periodEnd})`); skip++; continue; }
    if(!(monto>0) && !(usd>0)){ console.log(`  ✗ ${name}: sin deuda nacional ni internacional`); skip++; continue; }
    const hasNac=monto>0;
    if(hasNac){
      if(monto>50_000_000){ console.log(`  ✗ ${name}: montoFacturado fuera de rango (${o.montoFacturado})`); skip++; continue; }
      // evidencia: la línea fuente debe tener el monto y un label permitido, y NO uno prohibido
      const rl=norm(o.montoFacturadoRawLine);
      const okLabel=/(facturado a pagar|total a pagar)/.test(rl);
      const badLabel=/(anterior|cancelad|abono|saldo|pago )/.test(rl);
      const hasNum=digits(rl).includes(String(monto));
      if(!okLabel || badLabel || !hasNum){ console.log(`  ✗ ${name}: evidencia no valida monto (label=${okLabel} bad=${badLabel} num=${hasNum}) raw="${String(o.montoFacturadoRawLine).slice(0,50)}"`); skip++; continue; }
    }
    const bank=detectBank(dec.text.slice(0,1500))||String(o.bank||"").trim(), holder=String(o.holder||"").trim();
    if(!bank||!holder){ console.log(`  ✗ ${name}: falta bank/holder`); skip++; continue; }
    const cardKey=last4; // identidad = last4 (único entre las tarjetas del hogar; el banco/titular son ruidosos en el PDF)
    const smk=String(o.periodEnd).slice(0,7); const id=`${cardKey}::${smk}`;
    const prev:any=seen.get(id)??existing.get(id);
    // conflicto solo si AMBOS traen nacional y difieren (intl-only no entra en conflicto)
    if(hasNac && prev && Math.round(Number(prev.montoFacturado))>0 && Math.round(Number(prev.montoFacturado))!==monto){ console.log(`  ⚠ CONFLICTO ${name}: ${id} ya tiene ${clp(prev.montoFacturado)} != ${clp(monto)} — NO piso`); conflict++; continue; }
    const rec={ id, cardKey, cardLabel:`${bank} · ${holder} …${last4}`, bank, holder, last4,
      statementMonthKey:smk, paymentMonthKey:String(o.pagarHasta).slice(0,7),
      periodStart:/^\d{4}-\d{2}-\d{2}$/.test(String(o.periodStart))?o.periodStart:(prev?.periodStart??null), periodEnd:o.periodEnd, pagarHasta:o.pagarHasta,
      montoFacturado: hasNac?monto:Math.round(Number(prev?.montoFacturado)||0),
      montoMinimo: hasNac?(o.montoMinimo!=null?Math.round(Number(o.montoMinimo)):null):(prev?.montoMinimo??null),
      cupoTotal: hasNac?(o.cupoTotal!=null?Math.round(Number(o.cupoTotal)):null):(prev?.cupoTotal??null),
      cupoUtilizado: hasNac?(o.cupoUtilizado!=null?Math.round(Number(o.cupoUtilizado)):null):(prev?.cupoUtilizado??null),
      cupoDisponible: hasNac?(o.cupoDisponible!=null?Math.round(Number(o.cupoDisponible)):null):(prev?.cupoDisponible??null),
      deudaInternacionalUsd: Math.max(usd, Number(prev?.deudaInternacionalUsd)||0), currency:"CLP", source:"manual_file",
      sourceFileHash:fileHash,
      createdAt:(prev?.createdAt)??NOW, updatedAt:NOW };
    seen.set(id,rec);
    console.log(`  ✓ ${name}: ${rec.cardLabel} | ${smk} | a pagar ${clp(rec.montoFacturado)}${rec.deudaInternacionalUsd?` + US$${rec.deudaInternacionalUsd} intl`:""} | vence ${o.pagarHasta}`);
    if(APPLY) await setDoc(doc(db,"creditCardStatements",id),rec);
    ok++;
  }
  console.log(`\n${APPLY?"✅":"[DRY]"} cargados ${ok} | sin cambios ${unchanged} | descartados ${skip} | conflictos ${conflict}`);
})().catch(e=>{console.error("❌",e.message);process.exit(1);});
