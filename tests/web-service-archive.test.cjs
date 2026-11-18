'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const archiveScript=fs.readFileSync(require.resolve('../app/web/service-archive.js'),'utf8');
const contact={id:'contact-1',name:'测试客户',phone:'0000000000',address:'样例小区 101'};
const record={
  id:'record-1',fields:{problem:'间歇停机 <样例>',model:'样例型号',repair_date_precision:'unknown',
    treatment:'检查接线'},status:'active',archived_at:'2026-11-18T00:00:00Z',source_id:'source-1',
};

function archiveHarness(handler){
  const dom=new JSDOM('<main id="main"></main>',{url:'https://example.test/#service-search',runScripts:'outside-only'});
  dom.window.archiveRequest=handler;
  vm.runInContext(`
    const $=selector=>document.querySelector(selector);
    const state={};
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const shell=(title,subtitle,content)=>$('#main').innerHTML=content;
    const field=(label,name,value)=>'<label>'+label+'<input name="'+name+'" value="'+esc(value)+'"></label>';
    const stamp=value=>value;
    const hasPermission=()=>true;
    const api=window.archiveRequest;
    const FormState={freezeWhile:async(form,action)=>action()};
  `+archiveScript+'\nObject.assign(window,{archiveSearchPage,archiveHistoryPage});',dom.getInternalVMContext());
  return {dom,w:dom.window,doc:dom.window.document};
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('archive search keeps same-phone addresses separate in the results table and restores the query after returning',async()=>{
  const calls=[];
  const {dom,w,doc}=archiveHarness((path,method,body)=>{
    calls.push({path,method,query:body.q,offset:body.offset});
    if(body.q==='无匹配')return {items:[],next_offset:null};
    return body.offset?{items:[{...contact,id:'second-page'}],next_offset:null}
      :{items:[contact,{...contact,id:'contact-2',address:'样例小区 202'}],next_offset:50};
  });
  try{
    await w.archiveSearchPage();
    const form=doc.querySelector('form');
    form.elements.q.value=contact.phone;
    form.requestSubmit();
    await tick();
    const table=doc.querySelector('#service-history-results table');
    assert.deepEqual([...table.querySelectorAll('tbody a')].map(link=>link.hash),
      ['#service-detail?contact=contact-1','#service-detail?contact=contact-2']);
    assert.match(table.textContent,/样例小区 202/);
    doc.querySelector('[data-history-next]').click();
    await tick();
    await w.archiveSearchPage();
    assert.equal(calls.at(-1).offset,50);
    assert.equal(calls.at(-1).query,contact.phone);
    assert.equal(calls.at(-1).method,'POST');
    assert.equal(doc.querySelector('form').elements.q.value,contact.phone);
    doc.querySelector('form').elements.q.value='无匹配';
    doc.querySelector('form').requestSubmit();
    await tick();
    assert.match(doc.querySelector('#service-history-results').textContent,/当前已归档范围内未找到/);
  }finally{dom.window.close();}
});

test('history table keeps unknown dates and record controls together when a row is expanded',async()=>{
  const {dom,w,doc}=archiveHarness(()=>({contact,items:[record,{...record,id:'record-2',status:'voided',
    source_id:null,fields:{...record.fields,repair_date:'2026-10',repair_date_precision:'month'}}],next_offset:null}));
  try{
    await w.archiveHistoryPage(new w.URLSearchParams({contact:contact.id}));
    const table=doc.querySelector('table');
    assert.match(table.textContent,/维修日期未知/);
    const toggle=table.querySelector('button[aria-controls="archive-record-1"]');
    const details=doc.getElementById('archive-record-1');
    assert.equal(details.hidden,true);
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'true');
    assert.equal(details.hidden,false);
    assert.match(details.textContent,/检查接线/);
    assert.match(details.textContent,/补充处理结果/);
    assert.ok(details.querySelector('a[href="#source?id=source-1"]'));
    assert.match(table.textContent,/2026-10（仅知月份）/);
    assert.match(table.textContent,/已作废/);
    assert.equal(doc.getElementById('archive-record-2').querySelector('a[href^="#source"]'),null);
    toggle.click();
    assert.equal(details.hidden,true);
  }finally{dom.window.close();}
});
