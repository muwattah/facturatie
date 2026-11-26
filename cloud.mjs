// Prepared cloud adapter. Not connected to the v0.4 browser UI yet.
const BUCKET='factuurcheck-private';
export function createCloudAdapter(client){
 let household=null,revision=null;
 async function load(){
   household=null;revision=null;
   const auth=await client.auth.getUser();
   if(auth.error||!auth.data.user)throw Error('Log opnieuw in.');
   const membership=await client.from('fc_members').select('household_id').eq('user_id',auth.data.user.id).single();
   if(membership.error)throw Error('Geen toegang tot een gezin.');
   const h=membership.data.household_id;
   const state=await client.from('fc_archives').select('revision,dossiers').eq('household_id',h).single();
   if(state.error)throw Error('Gedeeld archief kon niet worden geladen.');
   household=h;revision=state.data.revision;
   return state.data.dossiers;
 }
 async function action(payload,file=null,operationId=crypto.randomUUID()){
   if(!household||revision===null)throw Error('Laad eerst het gedeelde archief.');
   const body={...payload,operationId,expectedRevision:revision};
   let request=body;
   if(file){const form=new FormData();form.append('payload',JSON.stringify(body));form.append('file',file);request=form}
   const result=await client.functions.invoke('factuurcheck',{body:request});
   if(result.error){
     // A timeout or HTTP failure can have happened after a committed write.
     // Invalidate revision; reload state, NEVER blindly retry or pay.
     revision=null;
     throw Error('Actie niet bevestigd. Vernieuw het gedeelde archief en controleer de status voordat je betaalt.');
   }
   if(result.data.kind==='replayed'){revision=null;throw Error('Eerdere actie gevonden. Vernieuw het archief; dit is geen betaaltoestemming.')}
   // Force a successful reload before a second mutation. Possible matches do not mutate.
   revision=result.data.kind==='possible'?result.data.revision:null;
   return result.data;
 }
 async function original(hash){
   if(!household||!/^[a-f0-9]{64}$/.test(hash))throw Error('Ongeldig document');
   const result=await client.storage.from(BUCKET).download(household+'/'+hash);
   if(result.error)throw Error('Origineel document kon niet worden geladen.');
   return result.data;
 }
 async function logout(){
   household=null;revision=null;
   const r=await client.auth.signOut({scope:'local'});if(r.error)throw r.error;
 }
 return {load,action,original,logout};
}
