import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Stripe from 'stripe';
import {createClient} from '@supabase/supabase-js';

const root=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
const auth=process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY):null;
const db=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
const price=process.env.STRIPE_COMBAT_PRICE_ID;
const site=process.env.PUBLIC_SITE_ORIGIN;
const configured=()=>Boolean(stripe&&auth&&db&&price&&site?.startsWith('https://')&&process.env.STRIPE_WEBHOOK_SECRET);
async function member(req,res,next){
  if(!auth)return res.status(503).json({error:'Authentication not configured'});
  const token=/^Bearer (.+)$/.exec(req.get('authorization')||'')?.[1];
  if(!token)return res.sendStatus(401);
  const {data,error}=await auth.auth.getUser(token);
  if(error||!data?.user)return res.sendStatus(401);
  req.user=data.user;next();
}
// IMPORTANT: raw webhook must precede express.json()
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
  if(!stripe||!db||!process.env.STRIPE_WEBHOOK_SECRET)return res.sendStatus(503);
  let event;
  try{event=stripe.webhooks.constructEvent(req.body,req.get('stripe-signature'),process.env.STRIPE_WEBHOOK_SECRET)}
  catch{return res.sendStatus(400)}
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
    const s=event.data.object;
    if(s.mode==='payment'&&s.payment_status==='paid'&&s.metadata?.programme==='combat-strength'&&s.client_reference_id&&s.metadata.user_id===s.client_reference_id){
      try{
        const items=await stripe.checkout.sessions.listLineItems(s.id,{limit:100});
        if(items.data.some(item=>item.price?.id===price)){
          const {error}=await db.from('programme_entitlements').upsert({user_id:s.client_reference_id,programme_id:'combat-strength',stripe_checkout_session_id:s.id,status:'active'},{onConflict:'stripe_checkout_session_id'});
          if(error)throw error;
        }
      }catch(err){console.error('Entitlement grant failed',err);return res.sendStatus(500)}
    }
  }
  // TODO before production: revoke access on refunds and disputes, reconcile webhook events.
  res.sendStatus(200);
});
app.use(express.json({limit:'16kb'}));
app.get('/api/health',(req,res)=>res.json({ok:true,commerceConfigured:configured()}));
app.post('/api/checkout',member,async(req,res)=>{
  if(!configured())return res.sendStatus(503);
  try{
    const session=await stripe.checkout.sessions.create({
      mode:'payment',line_items:[{price,quantity:1}],
      client_reference_id:req.user.id,customer_email:req.user.email,
      metadata:{programme:'combat-strength',user_id:req.user.id},
      success_url:site+'/member.html?checkout=success',
      cancel_url:site+'/member.html?checkout=cancelled'
    });
    res.json({url:session.url});
  }catch(err){console.error('Checkout failed',err);res.sendStatus(500)}
});
app.get('/api/me/programmes',member,async(req,res)=>{
  if(!db)return res.sendStatus(503);
  const {data,error}=await db.from('programme_entitlements').select('programme_id').eq('user_id',req.user.id).eq('status','active');
  if(error)return res.sendStatus(500);
  res.set('Cache-Control','no-store').json({programmes:(data||[]).map(x=>x.programme_id)});
});
app.post('/api/me/combat-strength/pdf',member,async(req,res)=>{
  if(!db)return res.sendStatus(503);
  const {data,error}=await db.from('programme_entitlements').select('id').eq('user_id',req.user.id).eq('programme_id','combat-strength').eq('status','active').limit(1);
  if(error)return res.sendStatus(500);
  if(!data?.length)return res.sendStatus(403);
  const {data:signed,error:signError}=await db.storage.from('paid-programmes').createSignedUrl('combat-strength/MStrength101_Combat_Strength_Package.pdf',60,{download:true});
  if(signError||!signed?.signedUrl)return res.status(503).json({error:'Private PDF not configured'});
  res.set('Cache-Control','no-store').json({url:signed.signedUrl});
});
app.use(express.static(root,{dotfiles:'deny'}));
app.get('*',(req,res)=>res.sendFile(path.join(root,'index.html')));
app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('MStrength101 server started'));
