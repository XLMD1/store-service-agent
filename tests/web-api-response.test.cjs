const {test}=require('node:test');
const assert=require('node:assert/strict');
const {api}=require('../app/web/app.js');

for(const status of [200,503])test(`${status}空响应不应伪报结果，提示按原操作核验且不自动重试`,async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async()=>++calls===1?new Response('{"csrf_token":"sample"}',{status:200}):new Response('',{status});
  try{
    await assert.rejects(api('/operations/sample/confirm','POST',{}),/按原操作核验/);
    assert.equal(calls,2);
  }finally{global.fetch=original;}
});
