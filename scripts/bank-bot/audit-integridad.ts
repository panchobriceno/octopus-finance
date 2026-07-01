/** Auditoría integral de integridad (READ-ONLY) — balance general del estado de los datos. */
import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
const le=(fp:string)=>{if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}};
le(path.join(process.cwd(),".env.local"));le(path.join(process.cwd(),"client",".env.local"));
const db=await getAuthedDb();
const arr=async(c:string)=>(await getDocs(collection(db,c))).docs.map(d=>({id:d.id,...(d.data() as any)}));
const clp=(n:any)=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
const dig=(s:any)=>String(s??"").replace(/\D/g,"");
(async()=>{
  const [tx,acc,cat,tpl,inst,im,cp,st]=await Promise.all(["transactions","accounts","categories","commitmentTemplates","commitmentInstances","importedMovements","clientPayments","creditCardStatements"].map(arr));
  const accIds=new Set(acc.map((a:any)=>a.id));
  const cardAccIds=new Set(acc.filter((a:any)=>a.type==="credit_card").map((a:any)=>a.id));
  const catNames=new Set(cat.map((c:any)=>`${c.name}|${c.type??"expense"}`));
  const tplIds=new Set(tpl.map((t:any)=>t.id));
  const txIds=new Set(tx.map((t:any)=>t.id));
  const ex=(t:any)=>(t.subtype??"actual")!=="planned"&&(t.status??"paid")!=="cancelled";
  console.log("===== AUDITORÍA DE INTEGRIDAD (read-only) =====\n");
  console.log(`Colecciones: tx=${tx.length} acc=${acc.length} cat=${cat.length} tpl=${tpl.length} inst=${inst.length} im=${im.length} cp=${cp.length} st=${st.length}\n`);
  // 1 categorías dup
  const cm=new Map<string,number>(); for(const c of cat) cm.set(`${c.name}|${c.type??"expense"}`,(cm.get(`${c.name}|${c.type??"expense"}`)??0)+1);
  const catDup=[...cm.entries()].filter(([,n])=>n>1);
  console.log(`1) Categorías duplicadas: ${catDup.length} → ${catDup.map(([k,n])=>k.split("|")[0]+"("+n+")").join(", ")}`);
  // 2 tx con categoría inexistente
  const orphanCat=tx.filter((t:any)=>t.category&&!catNames.has(`${t.category}|${t.type==="income"?"income":"expense"}`));
  console.log(`2) Transacciones con categoría que no existe en la lista: ${orphanCat.length}`);
  // 3 tx ejecutadas sin cuenta ni tarjeta
  const sinCuenta=tx.filter((t:any)=>ex(t)&&!t.accountId&&!t.cardAccountId&&t.movementType!=="transfer");
  console.log(`3) Transacciones ejecutadas SIN accountId ni cardAccountId: ${sinCuenta.length} (${clp(sinCuenta.reduce((s:number,t:any)=>s+Math.abs(Number(t.amount)||0),0))})`);
  // 4 cardAccountId colgante
  const staleCard=tx.filter((t:any)=>t.cardAccountId&&!cardAccIds.has(t.cardAccountId));
  console.log(`4) Transacciones con cardAccountId colgante (cuenta no existe/ no es tarjeta): ${staleCard.length}`);
  // 5 accountId colgante
  const staleAcc=tx.filter((t:any)=>t.accountId&&!accIds.has(t.accountId));
  console.log(`5) Transacciones con accountId colgante: ${staleAcc.length}`);
  // 6 transferencias incompletas
  const badTransfer=tx.filter((t:any)=>t.movementType==="transfer"&&ex(t)&&(!t.accountId||!t.destinationAccountId));
  console.log(`6) Transferencias ejecutadas incompletas (falta origen o destino): ${badTransfer.length}`);
  // 7 credit_card_payment sin cardAccountId
  const payNoCard=tx.filter((t:any)=>t.movementType==="credit_card_payment"&&ex(t)&&!t.cardAccountId);
  console.log(`7) Pagos de tarjeta sin cardAccountId: ${payNoCard.length}`);
  // 8 instancias huérfanas (sin template)
  const orphanInst=inst.filter((i:any)=>!tplIds.has(i.templateId));
  console.log(`8) commitmentInstances sin template: ${orphanInst.length}`);
  // 9 instancias paid sin transacción válida
  const badPaid=inst.filter((i:any)=>i.status==="paid"&&i.matchedTransactionId&&!txIds.has(i.matchedTransactionId));
  console.log(`9) Instancias 'paid' con matchedTransactionId que ya no existe: ${badPaid.length}`);
  // 10 importedMovements converted sin match
  const badConv=im.filter((m:any)=>m.status==="converted"&&(!m.matchedTransactionId||!txIds.has(m.matchedTransactionId)));
  console.log(`10) importedMovements 'converted' sin transacción válida: ${badConv.length}`);
  // 11 cobros vencidos
  const today=new Date().toISOString().slice(0,10);
  const overdueCobros=cp.filter((p:any)=>(p.status??"")!=="paid"&&(p.status??"")!=="cancelled"&&(p.expectedDate||p.dueDate)&&(p.expectedDate||p.dueDate)<today);
  console.log(`11) Cobros de cliente vencidos (sin pagar): ${overdueCobros.length} (${clp(overdueCobros.reduce((s:number,p:any)=>s+(Number(p.totalAmount)||0),0))})`);
  // 12 cuentas sin número
  const sinNum=acc.filter((a:any)=>!dig(a.accountNumber));
  console.log(`12) Cuentas sin número: ${sinNum.length} → ${sinNum.map((a:any)=>a.name).join(", ")||"—"}`);
  // 13 tarjetas sin cartola
  const stL4=new Set(st.map((s:any)=>s.last4));
  const cardsNoSt=acc.filter((a:any)=>a.type==="credit_card"&&!stL4.has(dig(a.accountNumber).slice(-4)));
  console.log(`13) Tarjetas sin estado de cuenta cargado: ${cardsNoSt.length} → ${cardsNoSt.map((a:any)=>a.name).join(", ")||"—"}`);
  // 14 cobertura accountId
  console.log(`14) Cobertura accountId/cardAccountId en tx ejecutadas: ${tx.filter((t:any)=>ex(t)&&(t.accountId||t.cardAccountId)).length}/${tx.filter(ex).length}`);
})();
