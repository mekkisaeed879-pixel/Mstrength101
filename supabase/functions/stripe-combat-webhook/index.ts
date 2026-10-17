import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
// Stripe webhooks do not carry Supabase JWTs. Validate their HMAC signature here.
const env=(k:string)=>Deno.env.get(k)||'';
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const reply=(status:number,message:string)=>new Response(message,{status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
function same(a:string,b:string){
  if(a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
async function verified(raw:string,header:string,secret:string){
  const values=header.split(',').map(x=>x.trim());
  const t=values.find(x=>x.startsWith('t='))?.slice(2);
  const signatures=values.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
  if(!t||!/^[0-9]+$/.test(t)||Math.abs(Date.now()/1000-Number(t))>300||!signatures.length)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw));
  const expected=[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join('');
  return signatures.some(candidate=>same(expected,candidate.toLowerCase()));
}
async function stripeGet(path:string,key:string){
  const response=await fetch('https://api.stripe.com/v1/'+path,{headers:{Authorization:'Bearer '+key}});
  if(!response.ok)throw Error('Stripe verification request failed: '+response.status);
  return await response.json();
}
async function revoke(intent:string,reason:string){
  if(!intent)return;
  const {error}=await db.rpc('revoke_combat_purchase',{p_payment_intent:intent,p_reason:reason});
  if(error)throw error;
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return reply(405,'POST required');
  const secret=env('STRIPE_WEBHOOK_SECRET'),key=env('STRIPE_SECRET_KEY'),price=env('STRIPE_COMBAT_PRICE_ID');
  if(!secret||!key||!price)return reply(503,'Stripe webhook not configured');
  const raw=await req.text();
  if(!await verified(raw,req.headers.get('stripe-signature')||'',secret))return reply(400,'Invalid signature');
  try{
    const event=JSON.parse(raw);
    if(typeof event.id!=='string'||typeof event.type!=='string')return reply(400,'Invalid event');
    if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
      const source=event.data?.object;
      if(!source||typeof source.id!=='string')return reply(400,'Invalid session');
      // Re-read directly from Stripe; never trust unverified client-supplied payment status.
      const session=await stripeGet('checkout/sessions/'+encodeURIComponent(source.id),key);
      if(session.payment_status!=='paid'||session.mode!=='payment'||session.status!=='complete')return reply(200,'Unpaid session ignored');
      if(session.metadata?.programme!=='combat-strength'||session.metadata?.user_id!==session.client_reference_id)return reply(200,'Not our programme');
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(session.client_reference_id||''))return reply(200,'Invalid member');
      const items=await stripeGet('checkout/sessions/'+encodeURIComponent(session.id)+'/line_items?limit=100',key);
      if(!items.data?.some((x:any)=>x.price?.id===price&&x.quantity===1))return reply(200,'Different price ignored');
      const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
      if(!intent)return reply(500,'Payment intent unavailable');
      const {error}=await db.rpc('record_combat_purchase',{
        p_user_id:session.client_reference_id,p_checkout_session:session.id,p_payment_intent:intent
      });
      if(error)throw error;
      return reply(200,'Purchase recorded');
    }
    if(event.type==='charge.refunded'){
      const charge=event.data?.object;
      if(charge?.refunded===true){
        const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
        if(intent)await revoke(intent,'refunded');
      }
      return reply(200,'Refund processed');
    }
    if(event.type==='charge.dispute.created'){
      const dispute=event.data?.object;
      if(typeof dispute?.charge==='string'){
        const charge=await stripeGet('charges/'+encodeURIComponent(dispute.charge),key);
        const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
        if(intent)await revoke(intent,'disputed');
      }
      return reply(200,'Dispute processed');
    }
    return reply(200,'Event ignored');
  }catch(error){
    console.error('Stripe webhook processing failed',error);
    return reply(500,'Retry later');
  }
});