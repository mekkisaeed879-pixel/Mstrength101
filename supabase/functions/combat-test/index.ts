import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

// Entirely separate Stripe TEST checkout: no live credentials, entitlements, or checkout flags.
const env=(name:string)=>Deno.env.get(name)||'';
const TEST_PRICE_ID='price_1URfp812wPi7k0d7KXFfPiRH';
const SITE='https://mstrength101.com';
const API='https://api.stripe.com/v1/';
const origins=new Set([SITE,'https://www.mstrength101.com']);
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{autoRefreshToken:false,persistSession:false}});
function cors(req:Request){
  const origin=req.headers.get('origin')||'';
  return {'Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),
    'Access-Control-Allow-Headers':'authorization,apikey,content-type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
}
function json(req:Request,status:number,data:unknown){
  return new Response(JSON.stringify(data),{status,headers:{...cors(req),'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function plain(status:number,message:string){
  return new Response(message,{status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
}
function ready(){
  return env('STRIPE_TEST_SECRET_KEY').startsWith('sk_test_') &&
    env('STRIPE_TEST_WEBHOOK_SECRET').startsWith('whsec_') &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env('TEST_ALLOWED_EMAIL'));
}
async function userFor(req:Request){
  const token=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')?.[1];
  if(!token)return null;
  const {data,error}=await db.auth.getUser(token);
  return error?null:data.user;
}
function allowed(user:{email?:string|null}|null){
  return !!user?.email&&!!env('TEST_ALLOWED_EMAIL') &&
    user.email.toLowerCase()===env('TEST_ALLOWED_EMAIL').toLowerCase().trim();
}
async function owns(id:string){
  const {data,error}=await db.from('combat_test_entitlements').select('checkout_session_id')
    .eq('user_id',id).eq('status','active').limit(1);
  if(error)throw error;
  return !!data?.length;
}
async function stripeGet(path:string){
  const r=await fetch(API+path,{headers:{'Authorization':'Bearer '+env('STRIPE_TEST_SECRET_KEY')}});
  if(!r.ok)throw Error('Stripe test verification failed: '+r.status);
  return r.json();
}
function constantTimeEqual(a:string,b:string){
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function validSignature(raw:string,header:string){
  const values=header.split(',').map(x=>x.trim());
  const t=values.find(x=>x.startsWith('t='))?.slice(2);
  const signatures=values.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
  if(!t||!/^[0-9]+$/.test(t)||Math.abs(Date.now()/1000-Number(t))>300||!signatures.length)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env('STRIPE_TEST_WEBHOOK_SECRET')),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw));
  const expected=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return signatures.some(v=>constantTimeEqual(expected,v.toLowerCase()));
}
async function revoke(intent:string,reason:string){
  if(!intent)return;
  const {error}=await db.rpc('revoke_combat_test_purchase',{p_payment_intent:intent,p_reason:reason});
  if(error)throw error;
}
async function webhook(req:Request){
  if(req.method!=='POST')return plain(405,'POST required');
  if(!ready())return plain(503,'Test checkout not configured');
  const raw=await req.text();
  if(!await validSignature(raw,req.headers.get('stripe-signature')||''))return plain(400,'Invalid signature');
  try{
    const e=JSON.parse(raw);
    if(e.livemode!==false||typeof e.id!=='string'||typeof e.type!=='string')
      return plain(400,'Invalid test event');
    if(e.type==='checkout.session.completed'||e.type==='checkout.session.async_payment_succeeded'){
      const sessionId=e.data?.object?.id;
      if(typeof sessionId!=='string'||!sessionId.startsWith('cs_test_'))return plain(400,'Invalid test session');
      const session=await stripeGet('checkout/sessions/'+encodeURIComponent(sessionId));
      if(session.livemode!==false||session.payment_status!=='paid'||session.mode!=='payment'||session.status!=='complete')
        return plain(200,'Unpaid or non-test session ignored');
      if(session.metadata?.programme!=='combat-strength-test'||session.metadata?.user_id!==session.client_reference_id)
        return plain(200,'Unrelated test purchase');
      const userId=session.client_reference_id;
      if(typeof userId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId))
        return plain(200,'Invalid member');
      const {data:userResponse,error:userError}=await db.auth.admin.getUserById(userId);
      if(userError||!allowed(userResponse.user))return plain(200,'Non-allowlisted member');
      const items=await stripeGet('checkout/sessions/'+encodeURIComponent(sessionId)+'/line_items?limit=100');
      if(!items.data?.some((x:any)=>x.price?.id===TEST_PRICE_ID && x.quantity===1 &&
        x.price?.unit_amount===1999&&x.price?.currency==='eur'))
        return plain(200,'Wrong test price');
      const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
      if(typeof intent!=='string'||!intent.startsWith('pi_'))return plain(500,'Payment intent unavailable');
      const {error}=await db.rpc('record_combat_test_purchase',{
        p_user_id:userId,p_checkout_session:session.id,p_payment_intent:intent
      });
      if(error)throw error;
      return plain(200,'Test purchase recorded');
    }
    if(e.type==='charge.refunded'){
      const charge=e.data?.object;
      if(charge?.refunded===true){
        const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
        if(intent)await revoke(intent,'test_refund');
      }
      return plain(200,'Test refund processed');
    }
    if(e.type==='charge.dispute.created'){
      const chargeId=e.data?.object?.charge;
      if(typeof chargeId==='string'){
        const charge=await stripeGet('charges/'+encodeURIComponent(chargeId));
        const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
        if(intent)await revoke(intent,'test_dispute');
      }
      return plain(200,'Test dispute processed');
    }
    return plain(200,'Test event ignored');
  }catch(err){
    console.error('Test webhook error',err);
    return plain(500,'Retry test event');
  }
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  const action=new URL(req.url).searchParams.get('action')||'';
  if(action==='health'&&req.method==='GET')
    return json(req,200,{ok:true,testMode:true,configured:ready(),priceId:TEST_PRICE_ID});
  if(action==='webhook')return webhook(req);
  const user=await userFor(req);
  if(!user)return json(req,401,{error:'Sign in first at the athlete portal'});
  if(!allowed(user))return json(req,403,{error:'Test checkout is restricted to the approved tester'});
  try{
    if(action==='access'&&req.method==='GET')
      return json(req,200,{testPurchase:await owns(user.id)});
    if(action==='pdf'&&req.method==='POST'){
      if(!await owns(user.id))return json(req,403,{error:'A completed test purchase is required'});
      const {data,error}=await db.storage.from('paid-programmes')
        .createSignedUrl('Combat Strength/MStrength101 Combat Strength Package.pdf.pdf',60,{download:true});
      if(error||!data?.signedUrl)return json(req,503,{error:'Programme PDF is unavailable'});
      return json(req,200,{url:data.signedUrl});
    }
    if(action==='checkout'&&req.method==='POST'){
      if(!ready())return json(req,503,{error:'Test checkout has not been configured'});
      if(await owns(user.id))return json(req,409,{error:'Test purchase already completed'});
      const params=new URLSearchParams();
      params.set('mode','payment');
      params.set('line_items[0][price]',TEST_PRICE_ID);
      params.set('line_items[0][quantity]','1');
      params.set('client_reference_id',user.id);
      params.set('customer_email',user.email!);
      params.set('metadata[programme]','combat-strength-test');
      params.set('metadata[user_id]',user.id);
      params.set('success_url',SITE+'/checkout-test.html?checkout=success');
      params.set('cancel_url',SITE+'/checkout-test.html?checkout=cancelled');
      const response=await fetch(API+'checkout/sessions',{
        method:'POST',
        headers:{'Authorization':'Bearer '+env('STRIPE_TEST_SECRET_KEY'),
                 'Content-Type':'application/x-www-form-urlencoded'},
        body:params
      });
      const data=await response.json();
      if(!response.ok||data.livemode!==false||
        typeof data.url!=='string'||!data.url.startsWith('https://checkout.stripe.com/'))
        return json(req,503,{error:'Could not create a test Stripe checkout session'});
      return json(req,200,{url:data.url});
    }
    return json(req,404,{error:'Unknown test action'});
  }catch(err){
    console.error('Test checkout failed',err);
    return json(req,500,{error:'Test service temporarily unavailable'});
  }
});
