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
    if(path.endsWith('/feedback'))return {saved:true};
    return {status:'answered',model:body.model,answer_id:'sample-answer',
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
    const api=window.fixture;
    const hasPermission=()=>true;
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
    form.elements.model.value='SAMPLE-2';
    form.elements.model.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(doc.querySelector('[data-repair-feedback]'),null);
    assert.equal(doc.querySelector('[data-repair-result] a'),null);
  }finally{w.close();}
});
