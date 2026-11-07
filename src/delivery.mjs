import { APP } from './app-info.mjs';
import {lookup} from 'node:dns/promises';import https from 'node:https';import http from 'node:http';import nodemailer from 'nodemailer';import {randomUUID} from 'node:crypto';import {publicAddress} from './public-content.mjs';import {requireThat,WorkspaceError} from './contracts.mjs';
export async function sendDelivery(delivery){
 if(delivery.channel==='email'){
  requireThat(process.env.LOCAL_WORKSPACE_SMTP_HOST&&process.env.LOCAL_WORKSPACE_MAIL_FROM,'DELIVERY_CONFIG','메일 전송에는 SMTP와 발신자 설정이 필요합니다.');const transport=nodemailer.createTransport({host:process.env.LOCAL_WORKSPACE_SMTP_HOST,port:Number(process.env.LOCAL_WORKSPACE_SMTP_PORT??465),secure:process.env.LOCAL_WORKSPACE_SMTP_SECURE!=='false',auth:process.env.LOCAL_WORKSPACE_SMTP_USER?{user:process.env.LOCAL_WORKSPACE_SMTP_USER,pass:process.env.LOCAL_WORKSPACE_SMTP_PASSWORD}:undefined,connectionTimeout:7000,socketTimeout:10000});const result=await transport.sendMail({from:process.env.LOCAL_WORKSPACE_MAIL_FROM,to:delivery.to,subject:delivery.subject,text:delivery.message,messageId:`<${delivery.id}@pageyard>`});return {receipt:String(result.messageId),status:250};
 }
 const url=new URL(delivery.url);requireThat(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&(!url.port||['80','443'].includes(url.port)),'REMOTE_URL','공개 HTTP(S) webhook 주소가 필요합니다.');const addresses=await lookup(url.hostname,{all:true});requireThat(addresses.length&&addresses.every(a=>publicAddress(a.address)),'REMOTE_PRIVATE','비공개 네트워크에는 전송하지 않습니다.');const body=Buffer.from(JSON.stringify(delivery.body));requireThat(body.length<=65536,'DELIVERY_SIZE','전송 내용이 너무 큽니다.');
 return new Promise((resolve,reject)=>{const chosen=addresses[0],request=(url.protocol==='https:'?https:http).request(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length,'User-Agent':`${APP.name}/0.1`,'Idempotency-Key':delivery.id},lookup:(_host,options,cb)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},response=>{let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>65536)request.destroy(new WorkspaceError('DELIVERY_RESPONSE','전송 응답이 너무 큽니다.'))});response.on('end',()=>response.statusCode>=200&&response.statusCode<300?resolve({status:response.statusCode,receipt:response.headers['x-request-id']??''}):reject(new WorkspaceError('DELIVERY_STATUS','전송 서버가 요청을 수락하지 않았습니다.',{status:response.statusCode})));response.on('error',reject)});request.setTimeout(10000,()=>request.destroy(new WorkspaceError('DELIVERY_UNKNOWN','응답을 확인하지 못했습니다. 중복을 피하려면 수신처를 확인하세요.')));request.on('error',reject);request.end(body)});
}
export class DeliveryWorker {
 constructor(workspace,{sender=sendDelivery,onChange=()=>{},now=()=>Date.now()}={}){this.workspace=workspace;this.sender=sender;this.onChange=onChange;this.now=now;this.running=false;}
 async tick(){if(this.running)return false;this.running=true;try{
  const snapshot=this.workspace.snapshot(),stale=snapshot.objects.find(o=>o.kind==='delivery'&&o.alive&&o.status==='sending'&&this.now()-Date.parse(o.lastAttemptAt??o.updatedAt)>30000),pending=snapshot.objects.find(o=>o.kind==='delivery'&&o.alive&&o.status==='queued');if(!pending&&!stale)return false;
  const command=operations=>{const result=this.workspace.execute({id:`delivery:${randomUUID()}`,actor:'delivery-worker',expectedRevision:this.workspace.revision,operations});this.onChange();return result};
  if(stale){command([{type:'delivery.update',id:stale.id,status:'unknown',error:'DELIVERY_UNKNOWN: 전송 도중 서비스가 중단됐습니다. 수신 결과를 확인하세요.'}]);return true;}
  command([{type:'delivery.update',id:pending.id,status:'sending'}]);
  try{const receipt=await this.sender(pending);command([{type:'delivery.update',id:pending.id,status:'sent',receipt:JSON.stringify(receipt)}]);}
  catch(error){const status=['DELIVERY_CONFIG','REMOTE_PRIVATE','REMOTE_URL','DELIVERY_STATUS','DELIVERY_SIZE'].includes(error.code)?'failed':'unknown';command([{type:'delivery.update',id:pending.id,status,error: `${error.code??'DELIVERY_UNKNOWN'}: ${error.message}`}]);}
  return true;
 }finally{this.running=false;}}
}
