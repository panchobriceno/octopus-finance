import fs from "node:fs"; import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function le(fp:string){if(!fs.existsSync(fp))return;for(const l of fs.readFileSync(fp,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#"))continue;const s=t.indexOf("=");if(s===-1)continue;const k=t.slice(0,s).trim();const v=t.slice(s+1).trim().replace(/^['"]|['"]$/g,"");if(k&&process.env[k]===undefined)process.env[k]=v;}}
le(path.join(process.cwd(),".env.local")); le(path.join(process.cwd(),"client",".env.local"));
const db=getFirestore(initializeApp({apiKey:process.env.VITE_FIREBASE_API_KEY!,authDomain:process.env.VITE_FIREBASE_AUTH_DOMAIN!,projectId:process.env.VITE_FIREBASE_PROJECT_ID!,storageBucket:process.env.VITE_FIREBASE_STORAGE_BUCKET!,messagingSenderId:process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,appId:process.env.VITE_FIREBASE_APP_ID!}));
(async()=>{
  for (const c of ["categories","account_settings","accountSettings","credit_card_settings","commitmentTemplates"]) {
    try { const s=await getDocs(collection(db,c)); console.log(`\n=== ${c} (${s.size}) ===`);
      s.docs.slice(0,40).forEach(d=>{const x=d.data() as any; console.log(`  ${d.id} | ${x.name??x.label??""} | type=${x.type??""} ws=${x.workspace??""}`);});
    } catch(e:any){ console.log(`\n=== ${c}: ${e.message}`); }
  }
})();
