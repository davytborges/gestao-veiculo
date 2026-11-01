import {initializeApp, getApps, getApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, setPersistence, browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {getFirestore, doc, getDocFromServer, onSnapshot, runTransaction} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
const firebaseConfig={apiKey:'AIzaSyDoZly1sMrvNtS91isAiWnR5YNdw5_1FiQ',authDomain:'minhas-recargas-byd.firebaseapp.com',projectId:'minhas-recargas-byd',storageBucket:'minhas-recargas-byd.firebasestorage.app',messagingSenderId:'141721087925',appId:'1:141721087925:web:975c09f90de7c9012773fc'};
const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=getAuth(app), db=getFirestore(app), provider=new GoogleAuthProvider();
const $=id=>document.getElementById(id),local=window.BYDLocal;
let uid=null,remoteRef=null,unsubscribe=null,loaded=false,revision=0,writeQueue=Promise.resolve(),lastRemote=null;
const status=(label,msg)=>{if($('re_cloudIndicator'))$('re_cloudIndicator').textContent=label;if($('re_cloudMessage'))$('re_cloudMessage').textContent=msg};
const normalize=s=>({tariff:Number(s?.tariff)||1.185,records:Array.isArray(s?.records)?s.records:[],closeDay:Number(s?.closeDay)||14,closings:s?.closings&&typeof s.closings==='object'?s.closings:{},locations:Array.isArray(s?.locations)?s.locations:['Casa','Trabalho']});
const valid=s=>Array.isArray(s?.records)&&s.records.every(r=>r&&typeof r.id==='string'&&typeof r.date==='string'&&Number.isFinite(Number(r.kwh)));
const keyFor=userId=>'byd-recargas-seguro-'+userId;
function readBackup(key){try{const obj=JSON.parse(localStorage.getItem(key));return valid(obj)?normalize(obj):null}catch{return null}}
function writeBackup(userId,s){if(!userId||!valid(s))return;try{const confirmed=normalize(s),old=readBackup(keyFor(userId));if(old?.records.some(r=>!confirmed.records.some(c=>c.id===r.id))){const archiveKey='byd-recargas-arquivo-'+userId;const archived=readBackup(archiveKey);const map=new Map((archived?.records||[]).map(r=>[r.id,r]));for(const r of old.records)map.set(r.id,r);localStorage.setItem(archiveKey,JSON.stringify({...old,records:[...map.values()]}))}localStorage.setItem(keyFor(userId),JSON.stringify(confirmed))}catch(e){status('Atenção','Não foi possível atualizar a cópia local: '+e.message)}}
const mergeRecords=(existing,incoming)=>{const map=new Map(existing.map(r=>[r.id,r]));for(const r of incoming)if(!map.has(r.id))map.set(r.id,r);return [...map.values()]};
function showRemote(data,myRevision){if(myRevision!==revision)return;const parsed=normalize(data);if(!valid(parsed)){status('Formato inesperado','O Firebase retornou um formato inválido. Nenhuma gravação será realizada.');loaded=false;return}
 const previous=lastRemote;loaded=true;
 // Nunca substituir visualização de histórico confirmado por leitura posterior vazia.
 if(previous?.records.length&&!parsed.records.length){status('Alerta de sincronização','O Firebase retornou lista vazia após conter recargas. Histórico anterior preservado neste aparelho.');return}
 lastRemote=parsed;local.apply(parsed);writeBackup(uid,parsed);status('Sincronizado',`${parsed.records.length} recarga(s) consultada(s) no Firebase.`);window.BYDHomeRefresh?.()
}
async function mergeToCloud(input,expectedRevision,expectedUid){
 if(expectedRevision!==revision||auth.currentUser?.uid!==expectedUid)throw Error('Conta Google alterada. Operação cancelada.');
 if(!valid(input))throw Error('Registros inválidos.');
 const proposed=normalize(input), ref=doc(db,'usuarios',expectedUid,'dados','estado');
 const result=await runTransaction(db,async tx=>{const snapshot=await tx.get(ref);const existing=snapshot.exists()?snapshot.data():{records:[]};if(!valid(existing))throw Error('Estrutura da nuvem inesperada; não foi possível gravar.');const current=normalize(existing);
 const next={...current,records:mergeRecords(current.records,proposed.records),tariff:proposed.tariff,closeDay:proposed.closeDay,closings:{...current.closings,...proposed.closings},locations:[...new Set([...current.locations,...proposed.locations])],updatedAt:new Date().toISOString()};tx.set(ref,next);return next});
 if(expectedRevision!==revision||auth.currentUser?.uid!==expectedUid)throw Error('Conta alterada durante a gravação. Confira os registros antes de continuar.');
 showRemote(result,expectedRevision);return result
}
function reset(user){revision++;const current=revision;uid=user?.uid||null;loaded=false;lastRemote=null;if(unsubscribe){unsubscribe();unsubscribe=null}remoteRef=null;
 // Limpa apenas a interface; jamais apagar o backup local de recuperação.
 local.clear();
 if(!user){$('re_loginGoogle').hidden=false;$('re_logoutGoogle').hidden=true;status('Desconectado','Entre com Google para acessar as recargas.');return}
 $('re_loginGoogle').hidden=true;$('re_logoutGoogle').hidden=false;remoteRef=doc(db,'usuarios',uid,'dados','estado');status('Carregando…','Conferindo os registros diretamente no Firebase.');
 getDocFromServer(remoteRef).then(async snapshot=>{
  if(current!==revision)return;
  const raw=snapshot.exists()?snapshot.data():{records:[]};
  if(!valid(raw)){status('Erro de formato','O documento remoto é inválido. Não cadastre novas recargas.');return}
  showRemote(raw,current);
 }).catch(e=>{if(current===revision){if(!loaded)status('Erro de conexão','Não foi possível confirmar os dados no Firebase: '+(e.message||e)+'. Seus backups locais foram preservados.')}});
 unsubscribe=onSnapshot(remoteRef,{includeMetadataChanges:true},snapshot=>{
  if(current!==revision||snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
  const raw=snapshot.exists()?snapshot.data():{records:[]};if(valid(raw)){showRemote(raw,current);}
 },e=>{if(current===revision)status('Falha de sincronização',e.message||String(e))});
}
async function deleteRecord(recordId){
 const myRevision=revision,myUid=uid;
 if(!loaded||!myUid||auth.currentUser?.uid!==myUid)throw Error('Aguarde a sincronização com o Firebase antes de excluir.');
 if(!confirm('Excluir definitivamente esta recarga do Firebase?'))return false;
 status('Excluindo…','Confirmando exclusão no Firebase.');
 const target=doc(db,'usuarios',myUid,'dados','estado');
 const result=await runTransaction(db,async tx=>{
  const snap=await tx.get(target);
  if(!snap.exists()||!valid(snap.data()))throw Error('Histórico remoto indisponível. Exclusão cancelada.');
  const raw=snap.data(),remaining=raw.records.filter(r=>r.id!==recordId);
  if(remaining.length===raw.records.length)throw Error('Recarga não encontrada na nuvem; atualize a página.');
  const next={...raw,records:remaining,updatedAt:new Date().toISOString()};tx.set(target,next);return next;
 });
 if(myRevision!==revision||auth.currentUser?.uid!==myUid)throw Error('A conta foi alterada durante a exclusão.');
 // Remova também do backup deste usuário para não restaurar um registro excluído.
 try{localStorage.setItem(keyFor(myUid),JSON.stringify(normalize(result)));}catch{}
 lastRemote=null;showRemote(result,myRevision);
 status('Sincronizado','Recarga excluída e confirmada no Firebase.');
 return true;
}
async function updateRecord(record){
 const myRevision=revision,myUid=uid;
 if(!loaded||!myUid||auth.currentUser?.uid!==myUid)throw Error('Aguarde a conexão do Firebase antes de editar.');
 if(!record||typeof record.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||!Number.isFinite(record.kwh)||record.kwh<=0||!Number.isFinite(record.tariff)||record.tariff<=0)throw Error('Dados inválidos para a recarga.');
 const docRef=doc(db,'usuarios',myUid,'dados','estado');status('Salvando alteração…','Atualizando a recarga no Firebase.');
 const result=await runTransaction(db,async tx=>{const snap=await tx.get(docRef);if(!snap.exists()||!valid(snap.data()))throw Error('Histórico remoto indisponível.');
 const raw=snap.data(),idx=raw.records.findIndex(x=>x.id===record.id);if(idx<0)throw Error('Recarga não encontrada no Firebase.');
 const list=raw.records.slice();list[idx]={...list[idx],date:record.date,kwh:record.kwh,tariff:record.tariff,location:record.location||'Casa'};
 const next={...raw,records:list,updatedAt:new Date().toISOString()};tx.set(docRef,next);return next});
 if(myRevision!==revision||auth.currentUser?.uid!==myUid)throw Error('Conta alterada durante a edição.');
 // Sobrescrever a cópia do usuário para refletir o valor editado, mantendo os IDs.
 try{localStorage.setItem(keyFor(myUid),JSON.stringify(normalize(result)))}catch{}
 lastRemote=null;showRemote(result,myRevision);status('Sincronizado','Recarga alterada e confirmada no Firebase.');return true;
}
async function commit(input){const current=revision,userId=uid;if(!loaded||!userId||auth.currentUser?.uid!==userId)throw Error('Aguarde autenticação e sincronização do Firebase.');
 status('Salvando…','Verificando e preservando registros existentes na nuvem.');
 const result=await mergeToCloud(input,current,userId);writeBackup(userId,result);status('Sincronizado',`${result.records.length} recarga(s) confirmada(s) no Firebase.`);return true
}
const enqueue=input=>{const job=writeQueue.catch(()=>{}).then(()=>commit(input));writeQueue=job.catch(()=>{});return job};
window.BYDCloud={commit:enqueue,deleteRecord,updateRecord,onLocalSave:input=>{
 if(!loaded||!uid){status('Aguardando','Entre com Google e aguarde o Firebase para alterar os dados.');return;}
 const ids=new Set((input.records||[]).map(r=>r.id));
 if(lastRemote?.records.some(r=>!ids.has(r.id))){status('Exclusão bloqueada','A exclusão de recargas permanece desativada para proteger o histórico.');local.apply(lastRemote);return}
 enqueue(input).catch(e=>{status('Erro ao salvar',e.message||String(e));if(lastRemote)local.apply(lastRemote)})
}};
const login=async()=>{try{await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,provider)}catch(e){if(e.code==='auth/popup-blocked'){try{await signInWithRedirect(auth,provider)}catch(x){status('Erro no login',x.message||String(x))}}else if(e.code!=='auth/popup-closed-by-user')status('Erro no login',e.message||String(e))}};
$('re_loginGoogle').onclick=login;
$('re_logoutGoogle').onclick=async()=>{if(confirm('Sair da conta Google neste aparelho?'))await signOut(auth)};
try{await getRedirectResult(auth)}catch(e){status('Erro no retorno do Google',e.message||String(e))}
window.addEventListener('byd-auth-change',event=>reset(event.detail.user));
if(window.BYDAuthSession?.resolved)reset(window.BYDAuthSession.user);
