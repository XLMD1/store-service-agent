'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require.resolve('../app/web/index.html'),'utf8');
const sources=[...html.matchAll(/<script defer src="\/web\/([^"]+)"/g)].map(match=>fs.readFileSync(require.resolve('../app/web/'+match[1]),'utf8')).join('\n');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>JSON.parse(JSON.stringify(value));
const quantities={on_hand:10,reserved:3,available:7};
const taskSeed=()=>({id:'task-1',text:'样例入库两台',version:2,state:'awaiting_confirmation',question:'',updated_at:'2026-11-03T10:00:00Z',created_at:'2026-11-03T10:00:00Z',budget:{model_attempts:1,max_model_attempts:3},items:[{id:'item-1',action:'inventory_inbound',state:'awaiting_confirmation',question:'',candidates:{},result:null,draft:{id:'draft-1',version:1,operation_id:'op-1',kind:'inventory_inbound',state:'ready',parameters:{warehouse_id:'w',model_id:'m',quantity:2,basis_note:'虚构到货依据',occurred:{precision:'date',date:'2026-11-03'}},preview:{warehouse:{name:'样例库'},model:{name:'样例型号'},before:quantities,after:{on_hand:12,reserved:3,available:9}}}}]});
async function harness(route='home',handler){
  const dom=new JSDOM(html,{url:'https://example.test/#'+route,runScripts:'outside-only'}),w=dom.window;const calls=[];let task=taskSeed();
  w.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-04T10:00:00Z']));}static now(){return new Date('2026-11-04T10:00:00Z').getTime();}};
  w.scrollTo=()=>{};w.matchMedia=()=>({matches:true});
  w.fetch=async(url,options={})=>{const path=String(url),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
    const custom=await handler?.({path,method,body},task);if(custom!==undefined)return custom;
    let value;if(path==='/api/auth/me')value={username:'sample',permissions:['inventory.read','inventory.inbound']};
    else if(path==='/api/auth/csrf')value={csrf_token:'synthetic'};
    else if(path==='/api/agent/status')value={configured:false,test_double:false,model:'deepseek-flash'};
    else if((path==='/api/agent/tasks'||path.startsWith('/api/agent/tasks?'))&&method==='GET')value=[task];
    else if(path==='/api/agent/tasks'&&method==='POST')value=task;
    else if(path==='/api/operations/op-1/confirm'){task=clone(task);task.state='completed';task.items[0].state='completed';task.items[0].result={business_id:'document-1',operation_id:'op-1',balance:{on_hand:12,reserved:3,available:9}};value=task.items[0].result;}
    else if(path.startsWith('/api/agent/tasks/task-1'))value=task;
    else if(path==='/api/catalog/warehouses')value=[{id:'w',name:'样例库',enabled:true}];
    else if(path==='/api/catalog/models')value=[{id:'m',name:'样例型号',enabled:true,aliases:[]}];
    else if(path==='/api/drafts')value=[];
    else throw Error('Unexpected endpoint '+path);
    return new Response(JSON.stringify(value),{status:200});
  };
  vm.runInContext(sources+'\nwindow.renderForTest=render;',dom.getInternalVMContext());await tick();await tick();return {dom,w,d:w.document,calls};
}
test('real home explains missing model and retains the same request id after lost save response',async()=>{
  let fail=true;const seen=[];
  const h=await harness('home',call=>{if(call.path==='/api/agent/tasks'&&call.method==='POST'){seen.push(call.body);if(fail){fail=false;throw Error('lost');}}});
  try{assert.match(h.d.querySelector('#main').textContent,/DeepSeek尚未配置/);const form=h.d.querySelector('#agent-task-form');form.elements.text.value='查询样例库';form.requestSubmit();await tick();await tick();assert.equal(form.elements.text.value,'查询样例库');assert.match(h.d.querySelector('#notice').textContent,/尚未核实任务保存结果/);form.requestSubmit();await tick();await tick();assert.equal(seen.length,2);assert.equal(seen[0].request_id,seen[1].request_id);assert.ok(h.calls.every(call=>call.path.startsWith('/api/')));}finally{h.dom.window.close();}
});
test('task preview never confirms automatically; browser checkbox gates the bound existing operation',async()=>{
  const h=await harness('task?id=task-1');
  try{assert.equal(h.d.querySelector('h1').textContent,'库存任务');assert.match(h.d.querySelector('#main').textContent,/10台/);assert.equal(h.calls.filter(c=>c.path.includes('/confirm')).length,0);const form=h.d.querySelector('[data-agent-confirm]');form.requestSubmit();await tick();assert.equal(h.calls.filter(c=>c.path.includes('/confirm')).length,0);form.elements.confirmed.checked=true;form.requestSubmit();await tick();await tick();const call=h.calls.find(c=>c.path.includes('/confirm'));assert.equal(call.body.draft_id,'draft-1');assert.equal(call.body.draft_version,1);assert.equal(call.body.parameters.quantity,2);assert.match(h.d.querySelector('#main').textContent,/document-1/);assert.equal(h.d.querySelector('[data-agent-confirm]'),null);}finally{h.dom.window.close();}
});
test('candidate picker submits explicit item, field, UUID and current task version, without auto-confirm',async()=>{
  const task=taskSeed();task.state='missing';task.items=[{id:'item-1',action:'query_inventory',state:'missing',question:'请选择库房',candidates:{warehouse:[{id:'w',label:'样例库 <script>unsafe</script>'}]},draft:null,result:null}];
  const h=await harness('task?id=task-1',call=>call.path==='/api/agent/tasks/task-1'&&call.method==='GET'?new Response(JSON.stringify(task)):undefined);
  try{const form=h.d.querySelector('[data-agent-select]');assert.ok(form.querySelector('[role=combobox]'));form.querySelector('.picker-trigger').click();form.querySelectorAll('[role=option]')[1].click();form.requestSubmit();await tick();await tick();const call=h.calls.find(c=>c.path.endsWith('/select'));assert.equal(call.body.expected_version,2);assert.equal(call.body.item_id,'item-1');assert.equal(call.body.field,'warehouse');assert.equal(call.body.value,'w');assert.equal(h.d.querySelector('#main script'),null);assert.equal(h.calls.filter(c=>c.path.includes('/confirm')).length,0);}finally{h.dom.window.close();}
});
test('late task response cannot overwrite a page the user navigated to',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);const h=await harness('home',call=>call.path==='/api/agent/tasks/task-1'&&call.method==='GET'?pending:undefined);
  try{h.w.location.hash='task?id=task-1';await tick();h.w.location.hash='inventory';await h.w.renderForTest();await tick();assert.equal(h.d.querySelector('h1').textContent,'库存');resolve(new Response(JSON.stringify(taskSeed())));await tick();await tick();assert.equal(h.d.querySelector('h1').textContent,'库存');}finally{h.dom.window.close();}
});

test('task shows the saved user followup beside the original request and escapes it',async()=>{
  const task=taskSeed();task.followups=['改为4台 <script>unsafe</script>'];
  const h=await harness('task?id=task-1',call=>call.path==='/api/agent/tasks/task-1'&&call.method==='GET'?new Response(JSON.stringify(task)):undefined);
  try{assert.match(h.d.querySelector('#main').textContent,/改为4台/);assert.equal(h.d.querySelector('#main script'),null);assert.equal(h.calls.filter(c=>c.path.includes('/confirm')).length,0);}finally{h.dom.window.close();}
});

test('initial planning and follow-up show an in-chat indicator only while the request is pending',async()=>{
  const releases=[];
  const task=taskSeed();
  const h=await harness('home',call=>{
    if(call.path==='/api/agent/tasks/task-1/run')return new Promise(resolve=>releases.push(resolve));
    if(call.path==='/api/agent/tasks/task-1')return new Response(JSON.stringify(task));
  });
  const thinking=()=>h.d.querySelector('#agent-thinking');
  try{
    const form=h.d.querySelector('#agent-task-form');
    form.elements.text.value='样例任务';
    form.requestSubmit();
    await tick();await h.w.renderForTest();
    assert.equal(thinking().hidden,false);
    assert.equal(thinking().closest('[role=status]').getAttribute('role'),'status');
    assert.equal(h.d.querySelector('#agent-reply button').disabled,true);
    task.question='请核对库存影响';
    releases.shift()(new Response(JSON.stringify(task)));
    await tick();await tick();
    assert.equal(thinking().hidden,true);
    assert.match(h.d.querySelector('.agent-conversation').textContent,/请核对库存影响/);
    const reply=h.d.querySelector('#agent-reply');
    reply.elements.reply.value='数量改为两台';
    reply.requestSubmit();
    await tick();
    assert.equal(thinking().hidden,false);
    assert.equal(reply.elements.reply.disabled,true);
    releases.shift()(new Response('{}',{status:503}));
    await tick();await tick();
    assert.equal(thinking().hidden,true);
    assert.equal(h.d.querySelector('#agent-reply button').disabled,false);
    assert.match(h.d.querySelector('#notice').textContent,/需要核验/);
  }finally{h.dom.window.close();}
});

test('a single incomplete draft uses the conversation form link while preview and multi-item details remain',async()=>{
  const task=taskSeed(),item=task.items[0],preview=item.draft.preview;
  item.action=item.draft.kind='inventory_outbound';
  task.state=item.state='missing';
  item.question='请补充实际发生日期。';
  item.draft.preview=null;
  const h=await harness('task?id=task-1',call=>call.path==='/api/agent/tasks/task-1'?new Response(JSON.stringify(task)):undefined);
  try{
    const original='#movement?draft=draft-1',link=()=>h.d.querySelector('.agent-conversation a.button').getAttribute('href');
    assert.equal(link(),original);
    assert.match(h.d.querySelector('.agent-message-assistant').textContent,/请补充实际发生日期/);
    assert.equal(h.d.querySelector('[data-agent-item]'),null);
    item.draft.preview=preview;
    task.state=item.state='awaiting_confirmation';
    await h.w.renderForTest();
    assert.ok(h.d.querySelector('[data-agent-confirm]'));
    assert.equal(h.d.querySelectorAll(`#main a[href="${original}"]`).length,1);
    task.items.push({...clone(item),id:'item-2',draft:{...clone(item.draft),id:'draft-2'}});
    await h.w.renderForTest();
    assert.equal(link(),'#inventory');
    assert.deepEqual([...h.d.querySelectorAll('[data-agent-item] a.button')].map(a=>a.getAttribute('href')),
      [original,'#movement?draft=draft-2']);
  }finally{h.dom.window.close();}
});

test('home calendar loads full month, selects dates, changes month and removes paste button',async()=>{
  const h=await harness('home');
  try{
    assert.equal(h.d.querySelector('#agent-paste'),null);
    assert.ok(h.calls.some(c=>c.path==='/api/agent/tasks?month=2026-11'));
    assert.ok(h.d.querySelector('[data-agent-date="2026-11-04"][aria-pressed="true"]'));
    assert.equal(h.d.querySelector('#agent-day-tasks a'),null);
    h.d.querySelector('[data-agent-date="2026-11-03"]').click();
    assert.ok(h.d.querySelector('#agent-day-tasks a[href="#task?id=task-1"]'));
    assert.match(h.d.querySelector('.agent-calendar-head').textContent,/\u5df2\u5b8c\u6210 0/);
    assert.match(h.d.querySelector('[data-agent-date="2026-11-03"]').getAttribute('aria-label'),/0\u9879\u5df2\u5b8c\u6210/);
    h.d.querySelector('[data-agent-date="2026-11-03"]').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(h.d.activeElement.dataset.agentDate,'2026-11-04');
    h.d.querySelector('#agent-month-prev').click();await tick();await tick();
    assert.ok(h.calls.some(c=>c.path==='/api/agent/tasks?month=2026-10'));
  }finally{h.dom.window.close();}
});

test('completed tasks disappear from pending after focus refresh while history is untouched',async()=>{
  let finished=false;const completed=clone(taskSeed());completed.id='finished';completed.state='completed';
  const h=await harness('pending',call=>call.path==='/api/agent/tasks?pending_only=true'?new Response(JSON.stringify(finished?[completed]:[completed,taskSeed()])):undefined);
  try{
    assert.equal(h.d.querySelector('a[href="#task?id=finished"]'),null);
    assert.ok(h.d.querySelector('a[href="#task?id=task-1"]'));
    finished=true;h.w.dispatchEvent(new h.w.Event('focus'));await tick();await tick();await tick();
    assert.equal(h.d.querySelector('a[href="#task?id=task-1"]'),null);
    assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
  }finally{h.dom.window.close();}
});

test('owner settings save and clear require explicit confirmation and never retain key',async()=>{
  const h=await harness('deepseek-settings',call=>{
    if(call.path==='/api/auth/me')return new Response(JSON.stringify({username:'owner',permissions:['inventory.read','account.manage']}));
    if(call.path==='/api/agent/settings')return new Response(JSON.stringify({configured:call.method==='POST',readable:true,source:call.method==='POST'?'local':'disabled',model:'deepseek-flash'}));
  });
  try{
    const form=h.d.querySelector('#agent-settings-form');assert.ok(form);
    form.elements.api_key.value='synthetic-ui-secret';form.requestSubmit();await tick();
    assert.equal(h.calls.filter(c=>c.path==='/api/agent/settings'&&c.method==='POST').length,0);
    form.elements.confirmed.checked=true;form.requestSubmit();await tick();await tick();
    const call=h.calls.find(c=>c.path==='/api/agent/settings'&&c.method==='POST');
    assert.deepEqual(call.body,{api_key:'synthetic-ui-secret',confirmed:true});
    assert.equal(h.d.querySelector('[name=api_key]').value,'');
    assert.ok(!h.d.querySelector('#main').textContent.includes('synthetic-ui-secret'));
    assert.equal(h.w.localStorage.length,0);
    const clear=h.d.querySelector('#agent-settings-clear');clear.requestSubmit();await tick();
    assert.equal(h.calls.filter(c=>c.method==='DELETE').length,0);
    clear.elements.confirmed.checked=true;clear.requestSubmit();await tick();await tick();
    assert.equal(h.calls.filter(c=>c.method==='DELETE').length,1);
  }finally{h.dom.window.close();}
});

test('owner sidebar groups daily work and collapses low frequency settings; active group expands',async()=>{
  const owner={username:'owner',permissions:['inventory.read','inventory.inbound','inventory.outbound','inventory.opening','inventory.correct','reservation.confirm','account.manage']};
  const h=await harness('home',call=>{
    if(call.path==='/api/auth/me')return new Response(JSON.stringify(owner));
    if(call.path==='/api/agent/settings')return new Response(JSON.stringify({configured:false,readable:true,source:'environment',model:'deepseek-flash'}));
  });
  try{
    const daily=h.d.querySelector('[data-sidebar-group=daily]');assert.ok(daily);
    assert.deepEqual([...daily.querySelectorAll('a')].map(a=>a.getAttribute('href')),['#home','#pending','#inventory','#inbound','#movement?kind=inventory_outbound','#reservations']);
    let setup=h.d.querySelector('[data-sidebar-group=setup]');assert.ok(!setup.open);
    setup.querySelector('summary').click();await tick();assert.ok(setup.open);
    setup.querySelector('summary').click();await tick();assert.ok(!setup.open);
    h.w.location.hash='deepseek-settings';await h.w.renderForTest();await tick();
    setup=h.d.querySelector('[data-sidebar-group=setup]');assert.ok(setup.open);
    assert.equal(setup.querySelector('[aria-current=page]').getAttribute('href'),'#deepseek-settings');
  }finally{h.dom.window.close();}
});

test('read-only sidebar has no empty owner group or unauthorized write links',async()=>{
  const h=await harness('home',call=>call.path==='/api/auth/me'?new Response(JSON.stringify({username:'reader',permissions:['inventory.read']})):undefined);
  try{
    assert.equal(h.d.querySelector('[data-sidebar-group=setup]'),null);
    assert.equal(h.d.querySelector('.desktop-sidebar a[href="#movement?kind=inventory_outbound"]'),null);
    assert.ok(h.d.querySelector('[data-sidebar-group=daily] a[href="#pending"]'));
  }finally{h.dom.window.close();}
});

test('ordinary outbound form marks note optional and highlights outbound navigation',async()=>{
  const h=await harness('movement?kind=inventory_outbound',call=>call.path==='/api/auth/me'?new Response(JSON.stringify({username:'stock',permissions:['inventory.read','inventory.outbound']})):undefined);
  try{
    assert.match(h.d.querySelector('#movement-form').textContent,/办理依据与备注（可选）/);
    assert.equal(h.d.querySelector('[name=basis_note]').required,false);
    assert.equal(h.d.querySelector('.desktop-sidebar [aria-current=page]').getAttribute('href'),'#movement?kind=inventory_outbound');
  }finally{h.dom.window.close();}
});

test('old outbound draft missing only note asks for a new preview without changing data on read',async()=>{
  const old={...taskSeed().items[0].draft,kind:'inventory_outbound',state:'missing',preview:null,operation_id:null,missing_fields:['basis_note']};old.parameters.basis_note='';
  const h=await harness('movement?draft=old-outbound',call=>{
    if(call.path==='/api/auth/me')return new Response(JSON.stringify({username:'stock',permissions:['inventory.read','inventory.outbound']}));
    if(call.path==='/api/drafts/old-outbound')return new Response(JSON.stringify(old));
  });
  try{
    assert.match(h.d.querySelector('#movement-preview').textContent,/备注现为可选.*重新保存.*预览/);
    assert.equal(h.calls.filter(c=>c.method!=='GET').length,0);
  }finally{h.dom.window.close();}
});

test('service source retains original and request id until a saved response and escapes the reading',async()=>{
  const original='  <img src="sample">\n虚构原文\n';
  const saved={id:'source-1',status:'saved',source_label:null,page_label:null,source_kind:null,submitted_at:'2026-11-11T00:00:00Z'};
  const posts=[];
  const h=await harness('sources',call=>{
    const ok=value=>new Response(JSON.stringify(value),{status:200});
    if(call.path==='/api/auth/me')return ok({username:'sample',permissions:['inventory.read','service.read','service.draft']});
    if(call.path==='/api/sources/policy')return ok({text_max_chars:12000});
    if(call.path==='/api/sources?offset=0')return ok({items:[],next_offset:null});
    if(call.path==='/api/sources'&&call.method==='POST'){
      posts.push(call.body);
      if(posts.length===1)throw new Error('simulated lost response');
      return ok(saved);
    }
    if(call.path==='/api/sources/source-1')return ok({...saved,text:original,message_time:null,note:null});
  });
  try{
    const form=h.d.querySelector('#source-form');
    form.elements.text.value=original;
    form.requestSubmit();
    await tick();await tick();
    assert.equal(form.elements.text.value,original);
    assert.match(h.d.querySelector('#notice').textContent,/尚未核实/);
    form.requestSubmit();
    await tick();await tick();
    assert.equal(posts[0].request_id,posts[1].request_id);
    assert.equal(posts[1].text,original);
    await h.w.renderForTest();
    assert.equal(h.d.querySelector('.service-source').textContent,original);
    assert.equal(h.d.querySelector('.service-source img'),null);
    assert.ok(h.d.querySelector('#source-drafts-retry'));
  }finally{h.dom.window.close();}
});
