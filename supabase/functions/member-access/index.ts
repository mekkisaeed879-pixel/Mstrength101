import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

// GitHub Pages is static. All privileged actions happen inside this Edge Function.
const env=(key:string)=>Deno.env.get(key)||'';
const site='https://mstrength101.com';
const allowed=new Set([site,'https://www.mstrength101.com','http://localhost:5173','http://localhost:3000']);
function cors(req:Request){
  const origin=req.headers.get('origin')||'';
  return {'Vary':'Origin',...(allowed.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Headers':'authorization,apikey,content-type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
}
function reply(req:Request,body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...cors(req),'Content-Type':'application/json','Cache-Control':'no-store'}});
}
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{autoRefreshToken:false,persistSession:false}});
async function identify(req:Request){
  const token=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')?.[1];
  if(!token)return null;
  const {data,error}=await db.auth.getUser(token);
  return error?null:data.user;
}
async function hasPurchase(userId:string){
  const {data,error}=await db.from('programme_entitlements').select('id').eq('user_id',userId).eq('programme_id','combat-strength').eq('status','active').limit(1);
  if(error)throw error;
  return Boolean(data?.length);
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  const url=new URL(req.url);
  if(req.method==='GET'&&url.searchParams.get('action')==='health')
    return reply(req,{ok:true,checkoutEnabled:env('CHECKOUT_ENABLED')==='true'});
  const user=await identify(req);
  if(!user)return reply(req,{error:'Sign in required'},401);
  try{
    const action=url.searchParams.get('action');
    if(req.method==='GET'&&action==='access'){
      const owned=await hasPurchase(user.id);
      return reply(req,{programmes:owned?['combat-strength']:[]});
    }
    if(req.method==='POST'&&action==='pdf'){
      if(!await hasPurchase(user.id))return reply(req,{error:'Purchase required'},403);
      const {data,error}=await db.storage.from('paid-programmes')
        .createSignedUrl('combat-strength/MStrength101_Combat_Strength_Package.pdf',60,{download:true});
      if(error||!data?.signedUrl)return reply(req,{error:'Programme PDF is not available yet'},503);
      return reply(req,{url:data.signedUrl});
    }
    if(req.method==='POST'&&action==='checkout'){
      // Fail closed: creating a Stripe price is not permission to launch sales.
      if(env('CHECKOUT_ENABLED')!=='true')return reply(req,{error:'New checkout is not launched yet'},503);
      const key=env('STRIPE_SECRET_KEY'),price=env('STRIPE_COMBAT_PRICE_ID');
      if(!key||!price||!user.email)return reply(req,{error:'Checkout is not configured'},503);
      if(await hasPurchase(user.id))return reply(req,{error:'Programme is already purchased'},409);
      const params=new URLSearchParams();
      params.set('mode','payment');
      params.set('line_items[0][price]',price);
      params.set('line_items[0][quantity]','1');
      params.set('client_reference_id',user.id);
      params.set('customer_email',user.email);
      params.set('metadata[programme]','combat-strength');
      params.set('metadata[user_id]',user.id);
      params.set('success_url',site+'/member.html?checkout=success');
      params.set('cancel_url',site+'/member.html?checkout=cancelled');
      const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{
        method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded'},
        body:params});
      const payload=await response.json();
      if(!response.ok||typeof payload.url!=='string'||!payload.url.startsWith('https://checkout.stripe.com/'))
        throw Error('Stripe session could not be created');
      return reply(req,{url:payload.url});
    }
    return reply(req,{error:'Unknown action'},404);
  }catch(err){console.error('member-access failed',err);return reply(req,{error:'Please try again later'},500);}
});