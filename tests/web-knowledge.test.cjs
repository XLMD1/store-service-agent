'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

test('manual page changes keep the existing viewer and review inputs mounted',async()=>{
  const dom=new JSDOM('<main id="main"></main>',{
    url:'https://example.test/#knowledge?id=manual-1&page=2',runScripts:'outside-only',
  });
  const {window:w}=dom;
  const doc=w.document;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('[autofocus]').focus();};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  let requests=0;
  w.fixture=async()=>{
    requests++;
    return {title:'虚构资料',document_code:'SAMPLE',edition:'B',state:'pending_review',models:['SAMPLE'],
      scans:[{position:1,first_page:1,last_page:3}],events:[]};
  };
  const page=fs.readFileSync(require.resolve('../app/web/knowledge.js'),'utf8');
  vm.runInContext(`
    const $=target=>document.querySelector(target);
    const esc=value=>String(value);
    const api=window.fixture;
    const history=window.history;
    const hasPermission=name=>['knowledge.read','knowledge.review'].includes(name);
    const shell=(title,subtitle,content)=>$('#main').innerHTML=content;
    const field=(label,name,value,attrs='',type='text')=>'<input name="'+name+'" type="'+type+'" value="'+value+'" '+attrs+'>';
    const check=label=>'<label><input name="confirmed" type="checkbox" required>'+label+'</label>';
  `+page+'\nwindow.knowledgePage=knowledgePage;',dom.getInternalVMContext());

  async function navigateInPlace(){
    return w.knowledgePage(new w.URLSearchParams(w.location.hash.split('?')[1]),true);
  }

  try{
    await w.knowledgePage(new w.URLSearchParams({id:'manual-1',page:'2'}));
    const form=doc.getElementById('knowledge-page-number');
    const review=doc.getElementById('knowledge-transition');
    const preview=doc.querySelector('.service-photo');
    review.elements.note.value='审核输入应保留';
    form.elements.page.value='3';
    form.requestSubmit();
    await navigateInPlace();
    assert.equal(requests,1);
    assert.equal(doc.getElementById('knowledge-page-number'),form);
    assert.equal(doc.getElementById('knowledge-transition'),review);
    assert.equal(review.elements.note.value,'审核输入应保留');
    assert.equal(preview.getAttribute('src'),'/api/knowledge/versions/manual-1/pages/3');
    assert.equal(form.querySelector('[data-manual-next]').getAttribute('aria-disabled'),'true');

    form.querySelector('[data-manual-previous]').click();
    assert.match(w.location.hash,/page=2$/);
    assert.equal(form.elements.page.value,'2');
    assert.equal(preview.getAttribute('alt'),'说明书印刷第 2 页');
    w.location.hash='#knowledge?id=manual-1&page=1';
    await navigateInPlace();
    assert.equal(form.querySelector('[data-manual-previous]').getAttribute('aria-disabled'),'true');
    const original=doc.querySelector('[data-manual-original]');
    assert.equal(original.getAttribute('href'),'/api/knowledge/versions/manual-1/pages/1');
    const currentRoute=w.location.hash;
    original.focus();
    const click=new w.MouseEvent('click',{bubbles:true,cancelable:true});
    assert.equal(original.dispatchEvent(click),false);
    const dialog=doc.querySelector('dialog[open]');
    assert.equal(dialog.querySelector('img').getAttribute('src'),'/api/knowledge/versions/manual-1/pages/1');
    assert.match(dialog.querySelector('h2').textContent,/印刷第 1 页/);
    dialog.querySelector('[autofocus]').click();
    assert.equal(doc.querySelector('dialog'),null);
    assert.equal(doc.activeElement,original);
    assert.equal(w.location.hash,currentRoute);
    assert.equal(review.elements.note.value,'审核输入应保留');
  }finally{dom.window.close();}
});

test('manual OCR reviews only explicitly selected pages and retries individual failures',async()=>{
  const dom=new JSDOM('<main></main>',{url:'https://example.test/',runScripts:'outside-only'});
  const {window:w}=dom;
  const doc=w.document;
  const calls=[];
  const first={page:19,status:'ready',title:'故障检查',keywords:'E3',source_excerpt:'样例原文',revision:0,
    current:null,original_url:'/api/knowledge/versions/sample/pages/19'};
  const failed={...first,page:20,status:'failed',original_url:'/api/knowledge/versions/sample/pages/20'};
  w.fixture=async(url,method,body)=>{
    calls.push({url,method,body});
    if(url.endsWith('/confirm'))return {items:body.entries.map(entry=>({...entry,revision:1}))};
    if(body?.first_page===20)return {items:[{...failed,status:'ready',title:'故障分析'}]};
    return {items:[first,failed]};
  };
  const page=fs.readFileSync(require.resolve('../app/web/knowledge.js'),'utf8');
  vm.runInContext(`
    const esc=value=>String(value);
    const api=window.fixture;
    const FormState={freezeWhile:(node,action)=>action()};
    const field=(label,name,value,attrs='',type='text')=>'<input name="'+name+'" type="'+type+'" value="'+value+'" '+attrs+'>';
    const check=label=>'<label><input name="confirmed" type="checkbox" required>'+label+'</label>';
  `+page+`\nconst root=document.querySelector('main');
    root.innerHTML=manualBatchPanel(19,21,19);
    bindManualBatch(root.querySelector('[data-manual-batch]'),'/knowledge/versions/sample');`,dom.getInternalVMContext());

  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  try{
    doc.querySelector('[data-batch-range]').requestSubmit();
    await settle();
    const row=doc.querySelector('[data-index-draft="19"]');
    assert.ok(row);
    assert.equal(row.querySelector('a').getAttribute('href'),first.original_url);
    row.querySelector('[name=keywords]').value='E3 故障';
    doc.querySelector('[data-batch-retry]').click();
    await settle();
    assert.equal(calls.at(-1).body.first_page,20);
    assert.equal(row.querySelector('[name=keywords]').value,'E3 故障');
    const review=doc.querySelector('[data-batch-review]');
    row.querySelector('[name=selected]').checked=true;
    review.requestSubmit();
    assert.notEqual(calls.at(-1).url.split('/').pop(),'confirm');
    review.elements.confirmed.checked=true;
    review.requestSubmit();
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)),{confirmed:true,entries:[
      {page:19,revision:0,title:'故障检查',keywords:'E3 故障',source_excerpt:'样例原文'},
    ]});
    assert.equal(row.querySelector('[name=selected]').checked,false);
    assert.equal(review.elements.confirmed.checked,false);
    assert.match(doc.querySelector('[data-batch-status]').textContent,/已确认 1 页/);
  }finally{w.close();}
});
