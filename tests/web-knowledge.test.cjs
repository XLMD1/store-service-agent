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
    assert.equal(doc.querySelector('[data-manual-original]').getAttribute('href'),'/api/knowledge/versions/manual-1/pages/1');
  }finally{dom.window.close();}
});
