/** Re-taguear cuentas de Octopus (Cuenta Corriente OM + Línea Santander OM) a workspace=business. */
import { collection, getDocs, doc, updateDoc } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import fs from "node:fs"; import path from "node:path";
const APPLY = process.argv.includes("--apply");
const TARGETS = new Set(["cuenta corriente om", "linea de credito santander om"]);
const norm = (s:any)=>String(s??"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
const db = await getAuthedDb();
const snap = await getDocs(collection(db,"accounts"));
const NOW = new Date().toISOString();
console.log(APPLY?"=== APLICANDO ===":"=== DRY-RUN (--apply) ===");
const manifest:any=[];
for(const d of snap.docs){
  const a=d.data() as any;
  if(!TARGETS.has(norm(a.name))) continue;
  if(a.workspace==="business"){console.log(`  = ${a.name}: ya business`);continue;}
  console.log(`  ${APPLY?"✓":"•"} ${a.name}: workspace "${a.workspace}" → "business", isShared → false`);
  manifest.push({id:d.id,name:a.name,was:{workspace:a.workspace,isShared:a.isShared??null}});
  if(APPLY) await updateDoc(doc(db,"accounts",d.id),{workspace:"business",isShared:false});
}
if(APPLY&&manifest.length){const mp=path.join(process.cwd(),"scripts","bank-bot",`_manifest-retag-om-${NOW.replace(/[:.]/g,"-")}.json`);fs.writeFileSync(mp,JSON.stringify(manifest,null,2));console.log("Manifest:",mp);}
console.log(`TOTAL: ${manifest.length}`);
