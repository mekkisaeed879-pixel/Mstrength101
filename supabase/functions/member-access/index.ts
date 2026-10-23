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

const HOSTED_PAYMENT_LINK_ID='plink_1UTkMOGY2fcKbCZOGLJUtGKr';
const HOSTED_PAYMENT_URL='https://buy.stripe.com/7sYeVd65SepC0J0ctk5Rm00';
const HOSTED_PRICE_ID='price_1URahDGY2fcKbCZO3eJNEhTk';
async function stripeRead(path:string){
  const key=env('STRIPE_SECRET_KEY').trim();
  if(!/^(sk_live_|rk_live_)/.test(key))throw Error('Live Stripe API key missing');
  const response=await fetch('https://api.stripe.com/v1/'+path,{
    headers:{Authorization:'Bearer '+key}
  });
  if(!response.ok)throw Error('Stripe verification unavailable: '+response.status);
  return await response.json();
}
function stripeId(id:unknown){
  return typeof id==='string'&&/^cs_live_[A-Za-z0-9]{10,}$/.test(id);
}
// Verifies the payment directly with Stripe; session IDs or redirect URLs alone grant nothing.
// Match the authenticated account email, exact payment link, price, paid state and refund state.
async function confirmHostedSession(user:{id:string,email?:string|null},sessionId:unknown){
  if(!stripeId(sessionId)||!user.email)return false;
  const session=await stripeRead('checkout/sessions/'+encodeURIComponent(sessionId as string));
  if(session.livemode!==true||session.payment_link!==HOSTED_PAYMENT_LINK_ID||
     session.payment_status!=='paid'||session.mode!=='payment'||session.status!=='complete'||
     session.currency!=='eur'||session.amount_subtotal!==1999)return false;
  const buyer=(session.customer_details?.email||session.customer_email||'').trim().toLowerCase();
  if(!buyer||buyer!==user.email.trim().toLowerCase())return false;
  const items=await stripeRead('checkout/sessions/'+encodeURIComponent(session.id)+'/line_items?limit=5');
  if(!Array.isArray(items.data)||items.data.length!==1||
     items.data[0].price?.id!==HOSTED_PRICE_ID||items.data[0].quantity!==1)return false;
  const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
  if(typeof intent!=='string'||!intent.startsWith('pi_'))return false;
  const payment=await stripeRead('payment_intents/'+encodeURIComponent(intent)+'?expand[]=latest_charge');
  const charge=payment.latest_charge;
  if(payment.livemode!==true||payment.status!=='succeeded'||payment.currency!=='eur'||
     payment.amount_received<1999||charge?.refunded||charge?.amount_refunded>0)return false;
  const {error}=await db.rpc('record_combat_purchase',{
    p_user_id:user.id,p_checkout_session:session.id,p_payment_intent:intent
  });
  if(error)throw error;
  return await hasPurchase(user.id);
}
async function recoverHostedPurchase(user:{id:string,email?:string|null}){
  if(!user.email)return false;
  // Stripe supports filtering Checkout Sessions by Payment Link and verified customer email.
  // For an established customer, scan bounded pages to find earlier completed purchases.
  let cursor='';
  for(let page=0;page<10;page++){
    const params=new URLSearchParams({payment_link:HOSTED_PAYMENT_LINK_ID,limit:'100'});
    if(cursor)params.set('starting_after',cursor);
    const result=await stripeRead('checkout/sessions?'+params.toString());
    if(!Array.isArray(result.data))throw Error('Stripe sessions response unavailable');
    for(const item of result.data){
      if(item.payment_status==='paid'&&await confirmHostedSession(user,item.id))return true;
    }
    if(!result.has_more||result.data.length===0)return false;
    cursor=result.data[result.data.length-1]?.id||'';
    if(!cursor)return false;
  }
  return false;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
  const url=new URL(req.url);
  if(req.method==='GET'&&url.searchParams.get('action')==='health'){
    let stripeCredentialsReady=false;
    let hostedPaymentsConfigured=false;
    try{
      const price=await stripeRead('prices/'+HOSTED_PRICE_ID);
      const sessions=await stripeRead('checkout/sessions?payment_link='+HOSTED_PAYMENT_LINK_ID+'&limit=1');
      const link=await stripeRead('payment_links/'+HOSTED_PAYMENT_LINK_ID);
      stripeCredentialsReady=price.livemode===true&&price.active===true&&
        price.currency==='eur'&&price.unit_amount===1999&&
        sessions.object==='list'&&Array.isArray(sessions.data)&&
        link.livemode===true&&link.url===HOSTED_PAYMENT_URL;
      hostedPaymentsConfigured=stripeCredentialsReady&&link.active===true;
    }catch(error){
      console.warn('Hosted Stripe live verification unavailable',String(error).slice(0,160));
    }
    return reply(req,{ok:true,checkoutEnabled:env('CHECKOUT_ENABLED')==='true',
      stripeCredentialsReady,hostedPaymentsConfigured,hostedPaymentLink:HOSTED_PAYMENT_URL});
  }
  const user=await identify(req);
  if(!user)return reply(req,{error:'Sign in required'},401);
  try{
    const action=url.searchParams.get('action');
    if(req.method==='POST'&&action==='claim'){
      const input=await req.json().catch(()=>({}));
      const owned=await confirmHostedSession(user,input.session_id);
      return reply(req,{owned},owned?200:403);
    }
    if(req.method==='POST'&&action==='recover'){
      if(await hasPurchase(user.id))return reply(req,{owned:true});
      return reply(req,{owned:await recoverHostedPurchase(user)});
    }
    if(req.method==='GET'&&action==='access'){
      const owned=await hasPurchase(user.id);
      return reply(req,{programmes:owned?['combat-strength']:[]});
    }
    if(req.method==='POST'&&action==='pdf'){
      if(!await hasPurchase(user.id))return reply(req,{error:'Purchase required'},403);
      const {data,error}=await db.storage.from('paid-programmes')
        .createSignedUrl('Combat Strength/MStrength101 Combat Strength Package.pdf.pdf',60,{download:true});
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