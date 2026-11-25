'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

test('repair shows checked citations and clears old feedback on model or prompt changes',async()=>{
  const dom=new JSDOM('<main></main>',{url:'https://example.test/#repair-assistant',runScripts:'outside-only'});
  const {window:w}=dom;
  const doc=w.document,calls=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('[autofocus]').focus();};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.fixture=async(path,method,body)=>{
    calls.push({path,method,body});
    if(path.endsWith('/models'))return {models:['SAMPLE-1','SAMPLE-2']};
    if(path==='/repair/feedback?offset=0')return {items:[{
      actor:'虚构师傅',model:'SAMPLE-1',answered_at:'2026-11-24T12:00:00Z',
      feedback:{rating:'wrong_source',note:'请核对引用页'},
      points:[{kind:'meaning',source:1,quote:'虚构 E3 答复',condition:''}],
      sources:[{version_id:'sample-manual',title:'虚构说明书',edition:'B',page:19,
        original_url:'/api/knowledge/versions/sample-manual/pages/19'}]
    }],next_offset:null};
    if(path.endsWith('/feedback'))return {saved:true};
    return {status:'answered',model:body.model,answer_id:'sample-answer',
      ...(!body.question&&!body.condition ? {manufacturer_guidance:body.model==='SAMPLE-1'
        ? [{source:1,quote:'样例厂家处理建议原文。'}] : []} : {}),
      points:[{kind:'meaning',source:1,quote:'虚构 E3 提示',condition:''}],
      sources:[{version_id:'sample-manual',title:'虚构说明书',edition:'B',page:19,
        original_url:'/api/knowledge/versions/sample-manual/pages/19'}]};
  };
  const knowledge=fs.readFileSync(require.resolve('../app/web/knowledge.js'),'utf8');
  const code=fs.readFileSync(require.resolve('../app/web/repair-assistant.js'),'utf8');
  vm.runInContext(`
    const $=s=>document.querySelector(s);
    const esc=value=>String(value??'');
    const field=(title,name,value,attrs='')=>'<input name="'+name+'" value="'+value+'" '+attrs+'>';
    const shell=(title,subtitle,html)=>$('main').innerHTML=html;
    const icon=name=>'<svg aria-hidden="true"><use href="#'+name+'"></use></svg>';
    const api=window.fixture;
    const hasPermission=permission=>permission!=='knowledge.publish'||window.canReview!==false;
    const stamp=value=>value;
    const FormState={freezeWhile:(node,action)=>action()};
  `+knowledge+'\n'+code+'\nwindow.run=repairAssistantPage;',dom.getInternalVMContext());
  try{
    await w.run();
    const form=doc.querySelector('#repair-ask');
    form.elements.model.value='SAMPLE-1';
    form.elements.problem.value='报 E3';
    form.requestSubmit();
    await new Promise(resolve=>setImmediate(resolve));
    const citation=doc.querySelector('[data-repair-result] a');
    assert.equal(citation.getAttribute('href'),'#knowledge?id=sample-manual&page=19');
    const guidance=[...doc.querySelectorAll('[data-repair-result] article')]
      .find(row=>row.querySelector('h3').textContent==='厂家处理建议');
    assert.ok(guidance);
    assert.match(guidance.textContent,/样例厂家处理建议原文/);
    assert.equal(guidance.querySelector('a').getAttribute('href'),citation.getAttribute('href'));
    assert.equal(guidance.closest('details'),null);
    assert.ok(doc.querySelector('[data-repair-feedback]'));
    citation.focus();
    const click=new w.MouseEvent('click',{bubbles:true,cancelable:true});
    assert.equal(citation.dispatchEvent(click),false);
    const reader=doc.querySelector('dialog[open]');
    assert.equal(reader.querySelector('img').getAttribute('src'),'/api/knowledge/versions/sample-manual/pages/19');
    reader.querySelector('[autofocus]').click();
    assert.equal(doc.activeElement,citation);
    assert.equal(w.location.hash,'#repair-assistant');
    assert.equal(form.elements.problem.value,'报 E3');
    assert.equal(doc.querySelector('[data-repair-result] a'),citation);
    assert.equal(calls.filter(call=>call.method==='POST').length,1);
    form.requestSubmit();
    assert.equal(calls.filter(call=>call.method==='POST').length,1);
    assert.equal(form.elements.condition,undefined);
    const follow=doc.querySelector('[data-followup] form');
    follow.elements.kind.value='question';
    follow.elements.message.value='这个提示是什么意思？';
    follow.requestSubmit();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.at(-1).body.condition,'');
    assert.equal(calls.at(-1).body.problem,'报 E3');
    follow.elements.kind.value='condition';
    follow.elements.message.value='开机就显示';
    follow.requestSubmit();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.at(-1).body.question,'这个提示是什么意思？');
    assert.equal(calls.at(-1).body.condition,'开机就显示');
    assert.equal(doc.querySelector('[data-repair-turns]').children.length,2);
    form.elements.model.value='SAMPLE-2';
    form.elements.model.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(doc.querySelector('[data-repair-feedback]'),null);
    assert.equal(doc.querySelector('[data-repair-result] a'),null);
    form.requestSubmit();
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(doc.querySelector('[data-repair-result]').textContent,/未登记该故障码的厂家处理建议/);
    const review=doc.querySelector('#repair-feedback-review');
    assert.ok(review);
    assert.ok(calls.every(call=>!call.path.startsWith('/repair/feedback?')));
    review.open=true;
    review.dispatchEvent(new w.Event('toggle'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(review.textContent,/出处错误/);
    assert.match(review.textContent,/请核对引用页/);
    assert.match(review.textContent,/虚构 E3 答复/);
    assert.equal(review.querySelector('a').getAttribute('href'),'#knowledge?id=sample-manual&page=19');
    w.canReview=false;
    await w.run();
    assert.equal(doc.querySelector('#repair-feedback-review'),null);
  }finally{w.close();}
});
