// Deployment candidate, not a production release. Auth is verified explicitly.
import {createClient} from 'npm:@supabase/supabase-js@2.49.4';
import {applyAction,validateDocument,isUuid,mimeTypes} from '../_shared/cloud-actions.mjs';

const ORIGIN='https://muwattah.github.io';
const BUCKET='factuurcheck-private';
const LIMIT=20*1024*1024;
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}})}
function validMagic(bytes:Uint8Array,mime:string){
 const ascii=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
 if(mime==='application/pdf')return ascii(0,5)==='%PDF-';
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png')return bytes[0]===137&&ascii(1,4)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
 if(mime==='image/webp')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
 if(mime==='image/heic'||mime==='image/heif')return ascii(4,8)==='ftyp'&&['heic','heix','hevc','hevx','mif1','msf1'].includes(ascii(8,12));
 return false;
}
Deno.serve(async req=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply({error:'Ongeldige origin'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Methode niet toegestaan'},405);
 try{
  const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!token)return reply({error:'Log eerst in'},401);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply({error:'Server niet ingesteld'},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await admin.auth.getUser(token);
  if(auth.error||!auth.data.user)return reply({error:'Ongeldige sessie'},401);
  const actor=auth.data.user.id;
  const membership=await admin.from('fc_members').select('household_id').eq('user_id',actor).maybeSingle();
  if(membership.error)return reply({error:'Toegang kon niet gecontroleerd worden'},503);
  if(!membership.data)return reply({error:'Geen toegang tot een huishouden'},403);
  const household=membership.data.household_id;
  if(Number(req.headers.get('content-length')||0)>LIMIT+100000)return reply({error:'Bestand te groot'},413);
  let payload:any,original:File|null=null;
  try{
   const type=req.headers.get('content-type')||'';
   if(type.includes('multipart/form-data')){
    const form=await req.formData();
    const raw=form.get('payload'),file=form.get('file');
    if(typeof raw!=='string'||raw.length>20000||!(file instanceof File))throw Error();
    payload=JSON.parse(raw);original=file;
   }else if(type.includes('application/json')){
    const raw=await req.text();if(raw.length>20000)throw Error();
    payload=JSON.parse(raw);
   }else throw Error();
  }catch{return reply({error:'Ongeldige aanvraag'},400)}
  if(!payload||typeof payload!=='object'||!isUuid(payload.operationId)||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)return reply({error:'Ongeldige aanvraagversie'},400);
  const old=await admin.from('fc_audit').select('revision,actor_id,action').eq('household_id',household).eq('operation_id',payload.operationId).maybeSingle();
  if(old.error)return reply({error:'Operatie kon niet worden gecontroleerd'},503);
  if(old.data){
   if(old.data.actor_id!==actor||old.data.action!==payload.action)return reply({error:'Operatie-ID al in gebruik'},409);
   return reply({kind:'replayed',operation_revision:old.data.revision,message:'Vernieuw het archief. Deze respons is geen nieuwe betaaltoestemming.'});
  }
  const state=await admin.from('fc_archives').select('revision,dossiers').eq('household_id',household).single();
  if(state.error)return reply({error:'Archief niet beschikbaar'},503);
  if(state.data.revision!==payload.expectedRevision)return reply({kind:'conflict',revision:state.data.revision,error:'Dossier gewijzigd. Vernieuw en controleer opnieuw.'},409);
  let doc:any=null,bytes:Uint8Array|null=null;
  if(payload.action==='register'){
   if(!original||original.size===0||original.size>LIMIT||!mimeTypes.includes(original.type))return reply({error:'Originele foto of PDF vereist (max. 20 MB)'},400);
   bytes=new Uint8Array(await original.arrayBuffer());
   if(!validMagic(bytes,original.type))return reply({error:'Bestandstype komt niet overeen met inhoud'},400);
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
   try{doc=validateDocument(payload.document,hash,original.type)}catch(e){return reply({error:e instanceof Error?e.message:'Ongeldige factuur'},400)}
  }else if(original)return reply({error:'Onverwacht bestand'},400);
  let outcome:any;
  try{outcome=applyAction(state.data.dossiers,payload,actor,new Date().toISOString(),doc)}catch(e){return reply({error:e instanceof Error?e.message:'Ongeldige actie'},400)}
  if(!outcome.rows)return reply({kind:outcome.kind,matches:outcome.matches,revision:state.data.revision});
  if(doc&&bytes){
   const path=household+'/'+doc.photo_hash;
   const result=await admin.storage.from(BUCKET).upload(path,bytes,{contentType:doc.file_type,upsert:false,cacheControl:'0'});
   if(result.error){
    // Only accept an existing exact hash path from a previous server upload.
    const status=String((result.error as any).statusCode??(result.error as any).status??'');
    if(status!=='409'&& !/already exists|duplicate/i.test(result.error.message))return reply({error:'Origineel bestand kon niet worden opgeslagen'},503);
   }
  }
  const commit=await admin.rpc('fc_commit_archive',{p_actor:actor,p_household:household,p_expected:payload.expectedRevision,p_next:outcome.rows,p_operation:payload.operationId,p_action:payload.action});
  if(commit.error)return reply({error:'Opslag niet bevestigd. Vernieuw en controleer; voer geen betaling uit op basis van deze fout.'},503);
  if(commit.data.kind==='conflict')return reply({kind:'conflict',revision:commit.data.revision,error:'Dossier gewijzigd. Vernieuw en controleer opnieuw.'},409);
  if(commit.data.kind==='replayed')return reply({kind:'replayed',revision:commit.data.revision,message:'Vernieuw. Geen nieuwe betaaltoestemming.'});
  return reply({kind:outcome.kind,invoice:outcome.invoice,reasons:outcome.reasons||[],revision:commit.data.revision});
 }catch{return reply({error:'Serverfout. Geen nieuwe betaling bevestigd.'},500)}
});
