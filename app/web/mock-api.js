'use strict';
/** Isolated, fictional, in-memory demo adapter. Never calls fetch or a real API. */
(function (root) {
  const roles = {
    clerk: ['service.read','service.draft','service.confirm','repair.query','inventory.read','reservation.confirm','reservation.cancel'],
    technician: ['service.read','service.draft','repair.query','knowledge.review','inventory.read'],
    stock_operator: ['inventory.read','inventory.inbound','inventory.outbound','reservation.pickup'],
    owner: ['service.read','service.draft','service.confirm','repair.query','inventory.read','inventory.inbound','inventory.outbound','reservation.confirm','reservation.cancel','reservation.pickup','inventory.opening','inventory.correct','catalog.manage','account.manage','knowledge.publish']
  };
  const permissions = {inventory_opening:'inventory.opening',inventory_inbound:'inventory.inbound',inventory_outbound:'inventory.outbound',reservation_create:'reservation.confirm',reservation_cancel:'reservation.cancel',reservation_pickup:'reservation.pickup',inventory_adjustment:'inventory.correct',inventory_correction:'inventory.correct'};
  const kinds = {inventory_opening:'opening',inventory_inbound:'inbound',inventory_outbound:'outbound',reservation_create:'reserve',reservation_cancel:'cancel',reservation_pickup:'pickup',inventory_adjustment:'adjustment',inventory_correction:'correction'};
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v==='object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((out,key)=>{out[key]=v[key];return out;},{}) : v);
  const now = () => new Date().toISOString();
  const day = value => value?.date || new Date(new Date(value.at).getTime()+28800000).toISOString().slice(0,10);
  const fail = (status,message) => { const error=new Error('【演示】'+message); error.status=status; throw error; };
  const integer = (value,min=0) => Number.isInteger(value)&&value>=min&&value<=2147483647;
  let scenario='normal', sequence=0, db, user;
  const id = () => '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0');
  function identity(role) { return {id:'00000000-0000-4000-9000-'+String(Object.keys(roles).indexOf(role)+1).padStart(12,'0'),username:'demo-'+role,roles:[role],permissions:roles[role],enabled:true}; }
  function allow(permission) { if(!user)fail(401,'请登录演示账号'); if(permission&&!user.permissions.includes(permission))fail(403,'当前演示角色无此权限'); }
  const accountKey = (w,m) => w+'/'+m;
  const find = (rows,key,label) => rows.find(row=>row.id===key)||fail(404,label+'不存在');
  const remaining = row => row.registered_quantity-row.picked_quantity-row.cancelled_quantity;
  function reservation(row) { return {...row,remaining_quantity:remaining(row),status:remaining(row)?'active':'ended',customer:find(db.customers,row.customer_id,'客户')}; }
  function balance(w,m) {
    const warehouse=find(db.warehouses,w,'库房'),model=find(db.models,m,'型号'),account=db.accounts[accountKey(w,m)];
    return {warehouse,model,status:account?'opened':'uninitialized',on_hand:account?.on_hand??null,reserved:account?.reserved??null,available:account?account.on_hand-account.reserved:null,t0:account?.t0??null,version:account?.version??null,queried_at:now(),reservations:db.reservations.filter(row=>row.warehouse.id===w&&row.model.id===m).map(reservation)};
  }
  function reset() {
    sequence=0;
    db={warehouses:[{id:id(),name:'样例一号库',code:'DEMO-01',enabled:true,version:1},{id:id(),name:'样例二号库',code:'DEMO-02',enabled:true,version:1}],models:[{id:id(),name:'样例空调 A1',aliases:['样例A'],enabled:true,version:1},{id:id(),name:'样例热水器 B2',aliases:[],enabled:true,version:1}],customers:[{id:id(),display_name:'样例客户甲',phone:null,address:'虚构演示地址',version:1}],accounts:{},reservations:[],documents:[],ledger:[],drafts:[],operations:[],revisions:[]};
    user=identity('owner');
    if(scenario!=='empty') {
      const warehouse=db.warehouses[0],model=db.models[0],key=accountKey(warehouse.id,model.id),account={id:id(),on_hand:12,reserved:2,t0:'2026-11-01T00:00:00.000Z',version:2,opening_reserved:2};
      db.accounts[key]=account;
      db.reservations.push({id:id(),account_id:account.id,customer_id:db.customers[0].id,warehouse,model,t0:account.t0,registered_quantity:2,picked_quantity:0,cancelled_quantity:0,is_opening:true,basis_note:'样例期初留货',basis_kind:'oral',version:1});
      const document={id:id(),warehouse,model,kind:'opening',original_quantity:8,effective_quantity:8,version:1,reservation_id:null,occurred:{precision:'datetime',at:account.t0},registered_at:now(),basis_note:'样例盘点起点',corrections:[],operation_id:id()};
      db.documents.push(document);
      db.ledger.push({id:id(),business_id:document.id,operation_id:document.operation_id,kind:'opening',quantity:8,on_hand_delta:8,reserved_delta:2,version:1,reservation_id:null,occurred:document.occurred,registered_at:document.registered_at,actor_id:user.id,actor_name:user.username,basis_note:document.basis_note,warehouse_id:warehouse.id,model_id:model.id});
      const inbound={...copy(document),id:id(),kind:'inbound',original_quantity:4,effective_quantity:4,occurred:{precision:'date',date:'2026-11-02'},basis_note:'样例到货单（虚构）',operation_id:id()};
      db.documents.push(inbound);
      db.ledger.push({...copy(db.ledger[0]),id:id(),business_id:inbound.id,operation_id:inbound.operation_id,kind:'inbound',quantity:4,on_hand_delta:4,reserved_delta:0,version:2,occurred:inbound.occurred,basis_note:inbound.basis_note});
    }
    return {scenario,demo:true};
  }
  function setScenario(value) { if(!['normal','empty','error','conflict','pending'].includes(value))fail(422,'未知场景');scenario=value;return {scenario,demo:true}; }
  function targets(p) {
    let r=null,original=null;
    if(p.reservation_id)r=find(db.reservations,p.reservation_id,'预留');
    if(p.document_id)original=find(db.documents,p.document_id,'原单');
    const w=p.warehouse_id||r?.warehouse.id||original?.warehouse.id,m=p.model_id||r?.model.id||original?.model.id;
    return {w,m,r,original};
  }
  function preview(kind,p) {
    let required=kind==='inventory_correction'?['document_id','new_quantity','basis_note']:kind==='inventory_opening'?['warehouse_id','model_id','t0','on_hand','basis_note']:(kind==='reservation_cancel'||kind==='reservation_pickup'?['reservation_id','quantity','occurred','basis_note']:['warehouse_id','model_id',kind==='inventory_adjustment'?'on_hand':'quantity','occurred','basis_note']);
    if(kind==='reservation_create')required.push('customer_id','basis_kind');
    const noteOptional=['inventory_inbound','inventory_outbound','reservation_create'].includes(kind);
    if(noteOptional)required=required.filter(key=>key!=='basis_note');
    const missing=required.filter(key=>p[key]===null||p[key]===undefined||p[key]==='');
    if(p.occurred){const field=p.occurred.precision==='date'?'date':'at';if(!p.occurred[field])missing.push('occurred.'+field);}
    for(const field of ['quantity','on_hand','new_quantity'])if(p[field]!=null&&!integer(p[field],field==='quantity'?1:0))fail(422,'数量必须是合法整数');
    if(!noteOptional&&p.basis_note&&!p.basis_note.trim())missing.push('basis_note');
    if(missing.length)return {missing,preview:null,versions:{}};
    const {w,m,r,original}=targets(p),before=balance(w,m),account=db.accounts[accountKey(w,m)];
    if(!before.warehouse.enabled||!before.model.enabled)fail(422,'请选择启用的库房和型号');
    const versions={warehouse:before.warehouse.version,model:before.model.version,account:account?.version??null,...(r?{reservation:r.version}:{}),...(original?{document:original.version}:{})};
    if(kind==='inventory_opening'&&account)fail(409,'该库房型号已经建账');
    if(kind!=='inventory_opening'&&!account)fail(422,'请先为该库房型号建账');
    if(kind==='inventory_correction'&&!['inbound','outbound','pickup'].includes(original.kind))fail(422,'此原单不可更正');
    if(p.occurred) {
      const occurred=p.occurred;
      if(!['date','datetime'].includes(occurred.precision))fail(422,'发生精度无效');
      if(occurred.precision==='datetime') {
        if(occurred.date||occurred.t0_relation||occurred.boundary_note||!/(Z|[+-]\d{2}:\d{2})$/.test(occurred.at)||!Number.isFinite(Date.parse(occurred.at)))fail(422,'精确时刻必须含时区且不可混入日期断言');
        if(Date.parse(occurred.at)<=Date.parse(account.t0))fail(422,'T0及之前事件已包含在期初');
      } else {
        if(occurred.at||!/^\d{4}-\d{2}-\d{2}$/.test(occurred.date))fail(422,'日期精度不可编造时刻');
        const openingDay=day({at:account.t0});
        if(occurred.date<openingDay||(occurred.date===openingDay&&occurred.t0_relation==='at_or_before'))fail(422,'T0及之前事件不能重复记账');
        if(occurred.date===openingDay) {
          if(occurred.t0_relation!=='after')missing.push('occurred.t0_relation');
          else if(!occurred.boundary_note?.trim())missing.push('occurred.boundary_note');
        }
      }
    }
    if(missing.length)return {missing,preview:null,versions};
    let h=account?.on_hand||0,s=account?.reserved||0,q=p.quantity??p.on_hand??p.new_quantity,dh=0,ds=0;
    if(kind==='inventory_opening') {
      if(!Number.isFinite(Date.parse(p.t0))||!/(Z|[+-]\d{2}:\d{2})$/.test(p.t0))fail(422,'T0必须含时区');
      for(const entry of p.opening_reservations||[]){find(db.customers,entry.customer_id,'客户');if(!integer(entry.remaining_quantity,1)||!entry.basis_note?.trim())fail(422,'期初预留资料无效');}
      dh=p.on_hand;ds=(p.opening_reservations||[]).reduce((sum,row)=>sum+row.remaining_quantity,0);
    } else if(kind==='inventory_inbound')dh=q;
    else if(kind==='inventory_outbound')dh=-q;
    else if(kind==='reservation_create'){find(db.customers,p.customer_id,'客户');if(!['oral','deposit','paid'].includes(p.basis_kind))fail(422,'留货依据无效');ds=q;}
    else if(kind==='reservation_cancel'||kind==='reservation_pickup'){if(q>remaining(r))fail(422,'超过该单剩余预留');ds=-q;if(kind==='reservation_pickup')dh=-q;}
    else if(kind==='inventory_adjustment')dh=p.on_hand-h;
    else if(kind==='inventory_correction') {
      const delta=p.new_quantity-original.effective_quantity;
      dh=original.kind==='inbound'?delta:-delta;
      if(original.kind==='pickup') {const linked=find(db.reservations,original.reservation_id,'原单预留');if(delta>remaining(linked)||linked.picked_quantity+delta<0)fail(422,'更正超出关联预留');ds=-delta;versions.reservation=linked.version;}
    }
    if(h+dh<0||s+ds<0||s+ds>h+dh||h+dh>2147483647)fail(422,'库存不足或预留超过实物');
    const after={on_hand:h+dh,reserved:s+ds,available:h+dh-s-ds};
    return {missing:[],versions,preview:{...after,warehouse:before.warehouse,model:before.model,before:{on_hand:h,reserved:s,available:h-s},after,quantity:q,...(kind==='reservation_create'?{customer:find(db.customers,p.customer_id,'客户')}:{}),reservation:r?reservation(r):null,original_document:original||null,on_hand_delta:dh,reserved_delta:ds}};
  }
  function actorDraft(draft) { allow(permissions[draft.kind]);if(draft.actor_id!==user.id)fail(403,'草稿属于其他演示账号'); }
  function saveDraft(body,existing) {
    const kind=existing?.kind||body.kind;
    if(!permissions[kind])fail(422,'未知业务种类');allow(permissions[kind]);
    if(existing){actorDraft(existing);if(existing.version!==body.expected_version||existing.state==='succeeded')fail(409,'草稿版本已变化或已提交');}
    const p=copy(body.parameters||{});
    if(kind==='inventory_opening')p.opening_reservations??=[];
    const calculated=preview(kind,p);
    const draft={id:existing?.id||id(),kind,updated_at:now(),parameters:p,version:(existing?.version||0)+1,actor_id:user.id,state:calculated.missing.length?'missing':'ready',missing_fields:calculated.missing,preview:calculated.preview,target_versions:calculated.versions,operation_id:null};
    if(existing){db.operations.filter(row=>row.draft_id===existing.id&&row.state==='pending').forEach(row=>{row.state='invalidated';});db.drafts[db.drafts.indexOf(existing)]=draft;}else db.drafts.push(draft);
    if(draft.preview){draft.operation_id=id();db.operations.push({id:draft.operation_id,draft_id:draft.id,draft_version:draft.version,state:'pending',result:null,parameters:copy(p)});}
    return draft;
  }
  function confirm(operationId,body) {
    const operation=find(db.operations,operationId,'操作'),draft=find(db.drafts,operation.draft_id,'草稿');actorDraft(draft);
    if(operation.draft_id!==body.draft_id||operation.draft_version!==body.draft_version||canonical(operation.parameters)!==canonical(body.parameters))fail(409,'确认内容与原预览不一致');
    if(operation.state==='succeeded')return operation.result;
    if(operation.state!=='pending'||draft.operation_id!==operation.id)fail(409,'旧操作已失效，请重新预览');
    if(scenario==='conflict')fail(409,'模拟目标版本冲突，请切回正常并重新保存草稿');
    const calculated=preview(draft.kind,draft.parameters);
    if(calculated.missing.length||canonical(calculated.versions)!==canonical(draft.target_versions))fail(409,'目标版本已变化，请重新保存草稿');
    const p=draft.parameters,{w,m,r,original}=targets(p),key=accountKey(w,m),impact=calculated.preview;
    let account=db.accounts[key],linked=r;
    if(!account){account={id:id(),t0:p.t0,on_hand:0,reserved:0,version:0,opening_reserved:impact.reserved_delta};db.accounts[key]=account;}
    account.on_hand=impact.after.on_hand;account.reserved=impact.after.reserved;account.version++;
    const addReservation=(customerId,q,note,isOpening,basisKind)=>{const row={id:id(),account_id:account.id,customer_id:customerId,warehouse:impact.warehouse,model:impact.model,t0:account.t0,registered_quantity:q,picked_quantity:0,cancelled_quantity:0,is_opening:isOpening,basis_note:note,basis_kind:basisKind,version:1};db.reservations.push(row);return row;};
    if(draft.kind==='inventory_opening')for(const row of p.opening_reservations) addReservation(row.customer_id,row.remaining_quantity,row.basis_note,true,'oral');
    if(draft.kind==='reservation_create')linked=addReservation(p.customer_id,p.quantity,p.basis_note,false,p.basis_kind);
    if(draft.kind==='reservation_pickup'){r.picked_quantity+=p.quantity;r.version++;}
    if(draft.kind==='reservation_cancel'){r.cancelled_quantity+=p.quantity;r.version++;}
    const registered=now(),occurred=original?{precision:'datetime',at:registered}:p.occurred||{precision:'datetime',at:p.t0},documentId=id(),ledgerId=id();
    const document={id:documentId,warehouse:impact.warehouse,model:impact.model,kind:kinds[draft.kind],original_quantity:impact.quantity,effective_quantity:impact.quantity,version:1,reservation_id:linked?.id||original?.reservation_id||null,occurred:copy(occurred),registered_at:registered,basis_note:p.basis_note,corrections:[],operation_id:operation.id,original_document_id:original?.id||null,old_quantity:original?.effective_quantity??null,new_quantity:p.new_quantity??null};
    if(draft.kind==='inventory_adjustment')document.original_quantity=document.effective_quantity=impact.on_hand_delta;
    if(original){document.original_quantity=document.effective_quantity=p.new_quantity-original.effective_quantity;const delta=p.new_quantity-original.effective_quantity;if(original.kind==='pickup'){linked=find(db.reservations,original.reservation_id,'预留');linked.picked_quantity+=delta;linked.version++;}original.corrections.push({id:documentId,old_quantity:original.effective_quantity,new_quantity:p.new_quantity,registered_at:registered,basis_note:p.basis_note});original.effective_quantity=p.new_quantity;original.version++;}
    db.documents.push(document);
    db.ledger.push({id:ledgerId,business_id:documentId,operation_id:operation.id,original_document_id:document.original_document_id,old_quantity:document.old_quantity,new_quantity:document.new_quantity,kind:document.kind,quantity:document.effective_quantity,on_hand_delta:impact.on_hand_delta,reserved_delta:impact.reserved_delta,version:account.version,reservation_id:document.reservation_id,occurred:copy(occurred),registered_at:registered,actor_id:user.id,actor_name:user.username,basis_note:p.basis_note,warehouse_id:w,model_id:m});
    operation.state='succeeded';draft.state='succeeded';
    operation.result={demo:true,draft_id:draft.id,draft_version:draft.version,account_id:account.id,...(draft.kind==='inventory_opening'?{opening_reserved:account.opening_reserved}:{}),...(original||draft.kind==='inventory_adjustment'?{delta:original?p.new_quantity-document.old_quantity:impact.on_hand_delta,old_quantity:original?document.old_quantity:impact.before.on_hand,new_quantity:impact.quantity}:{}),kind:draft.kind,business_id:documentId,operation_id:operation.id,ledger_ids:[ledgerId],actor_id:user.id,quantity:impact.quantity,occurred:copy(occurred),registered_at:registered,t0:account.t0,balance:balance(w,m),reservation:linked?reservation(linked):null,original_document_id:original?.id||null};
    if(scenario==='pending')fail(0,'模拟回执连接中断，结果待核验；请按原操作核验');
    return operation.result;
  }
  const matches = (row,q) => (!q.get('warehouse_id')||row.warehouse.id===q.get('warehouse_id'))&&(!q.get('model_id')||row.model.id===q.get('model_id'));
  const dateMatches = (occurred,q) => (!q.get('start')||day(occurred)>=q.get('start'))&&(!q.get('end')||day(occurred)<=q.get('end'));
  function objects(q) {return db.warehouses.flatMap(w=>db.models.map(m=>balance(w.id,m.id))).filter(row=>matches(row,q));}
  function route(path,method,body) {
    const url=new URL(path,'https://demo.invalid'),parts=url.pathname.replace(/^\/api(?=\/)/,'').split('/').filter(Boolean),q=url.searchParams;
    if(scenario==='error')fail(503,'模拟接口暂不可用，请切换正常场景重试');
    if(parts[0]==='auth') {
      if(parts[1]==='csrf'&&method==='GET')return {csrf_token:'demo-only-no-server-token'};
      if(parts[1]==='login'&&method==='POST'){const role=String(body?.username||'').replace(/^demo-?/,'')||'owner';if(!roles[role]||!['demo','演示'].includes(body?.password))fail(401,'使用demo-owner等演示账号，口令demo或演示');user=identity(role);return user;}
      if(parts[1]==='logout'&&method==='POST'){user=null;return {demo:true};}
      if(parts[1]==='me'&&method==='GET'){allow();return user;}
    }
    allow();
    if(parts[0]==='catalog'&&['warehouses','models','customers'].includes(parts[1])) {
      const collection=db[parts[1]];
      if(method==='GET'&&parts.length===2)return collection;
      allow(parts[1]==='customers'?'reservation.confirm':'catalog.manage');
      if(body?.confirmed!==true)fail(422,'需明确人工确认');
      if(method==='POST'&&parts.length===2){const field=parts[1]==='customers'?'display_name':'name';if(!body[field]?.trim())fail(422,'名称必填');if(collection.some(row=>row[field]===body[field]||(body.code&&row.code===body.code)))fail(409,'资料名称或编码重复');const row={...copy(body),id:id(),version:1,enabled:true};delete row.confirmed;if(parts[1]==='models')row.aliases??=[];if(parts[1]==='warehouses')row.code||='DEMO-'+row.id.slice(-4);if(parts[1]==='customers'){row.phone??=null;row.address??=null;}collection.push(row);return row;}
      if(method==='PATCH'&&parts.length===3){const row=find(collection,parts[2],'资料');if(body.expected_version!==row.version)fail(409,'资料版本已变化');db.revisions.push(copy(row));const update=copy(body);delete update.confirmed;delete update.expected_version;Object.assign(row,update,{version:row.version+1});return row;}
    }
    if(parts[0]==='drafts') {
      if(method==='GET'&&parts.length===1)return db.drafts.filter(row=>row.actor_id===user.id&&user.permissions.includes(permissions[row.kind])&&['missing','ready'].includes(row.state));
      if(method==='POST'&&parts.length===1)return saveDraft(body);
      if(parts.length===2){const row=find(db.drafts,parts[1],'草稿');actorDraft(row);if(method==='DELETE'){
          if(row.state==='deleted')return null;
          if(!['missing','ready'].includes(row.state)||row.version!==Number(q.get('expected_version')))fail(409,'草稿已变化或已提交');
          for(const op of db.operations)if(op.draft_id===row.id&&op.state==='pending')op.state='superseded';
          row.state='deleted';row.version+=1;return null;
        }
        if(row.state==='deleted')fail(404,'草稿已删除');
        if(method==='GET')return row;if(method==='PATCH')return saveDraft(body,row);}
    }
    if(parts[0]==='operations'&&parts.length>=2) {
      if(method==='POST'&&parts.length===3&&parts[2]==='confirm')return confirm(parts[1],body);
      if(method==='GET'&&parts.length===2){const op=find(db.operations,parts[1],'操作');actorDraft(find(db.drafts,op.draft_id,'草稿'));return {id:op.id,state:op.state,result:op.result};}
    }
    if(parts[0]==='inventory'&&method==='GET'&&parts.length===2) {
      allow(parts[1]==='reconciliation'?'inventory.correct':'inventory.read');
      if(q.get('start')&&q.get('end')&&q.get('start')>q.get('end'))fail(422,'开始日期不能晚于结束日期');
      if(parts[1]==='balance')return balance(q.get('warehouse_id'),q.get('model_id'));
      if(parts[1]==='overview') {const warehouse=find(db.warehouses,q.get('warehouse_id'),'库房'),items=db.models.filter(m=>!q.get('model_id')||m.id===q.get('model_id')).map(m=>{const row=balance(warehouse.id,m.id);return {model:row.model,status:row.status,on_hand:row.on_hand,reserved:row.reserved,available:row.available,t0:row.t0,version:row.version};}),opened=items.filter(row=>row.status==='opened');return {warehouse,items,queried_at:now(),totals:{on_hand:opened.length?opened.reduce((s,r)=>s+r.on_hand,0):null,reserved:opened.length?opened.reduce((s,r)=>s+r.reserved,0):null,available:opened.length?opened.reduce((s,r)=>s+r.available,0):null,opened_model_count:opened.length,uninitialized_model_count:items.length-opened.length}};}
      if(parts[1]==='reservations')return db.reservations.filter(row=>matches(row,q)&&(q.get('active_only')==='false'||remaining(row)>0)).map(reservation).filter(row=>!q.get('q')||[row.id,row.customer.display_name,row.customer.phone,row.customer.address].some(v=>v?.includes(q.get('q'))));
      if(parts[1]==='ledger')return db.ledger.filter(row=>(!q.get('warehouse_id')||row.warehouse_id===q.get('warehouse_id'))&&(!q.get('model_id')||row.model_id===q.get('model_id'))&&(!q.get('kind')||row.kind===q.get('kind'))&&(!q.get('reservation_id')||row.reservation_id===q.get('reservation_id'))&&dateMatches(row.occurred,q)).map(row=>({...row,quantity:find(db.documents,row.business_id,'流水原单').effective_quantity})).reverse();
      const docs=db.documents.filter(row=>['inbound','outbound','pickup'].includes(row.kind)&&matches(row,q));
      if(parts[1]==='documents')return docs;
      if(parts[1]==='statistics') {
        if(!q.get('start')||!q.get('end'))fail(422,'统计需要开始和结束日期');
        const groupBy=q.get('group_by')||'date';if(!['date','warehouse','model'].includes(groupBy))fail(422,'统计分组无效');
        const selected=docs.filter(row=>row.kind==='inbound'&&dateMatches(row.occurred,q)),groups={};
        for(const row of selected){const key=groupBy==='date'?day(row.occurred):row[groupBy].id;groups[key]??={key,label:groupBy==='date'?key:row[groupBy].name,quantity:0};groups[key].quantity+=row.effective_quantity;}
        const coverage=objects(q).map(row=>{const t=row.t0?day({at:row.t0}):null,today=day({at:now()});return {warehouse:row.warehouse,model:row.model,status:row.status,t0:row.t0,coverage_status:!t?'uninitialized':q.get('end')<t?'before_t0':q.get('start')>today?'future':q.get('start')<=t||q.get('end')>today?'partial':'covered'};});
        return {start:q.get('start'),end:q.get('end'),group_by:groupBy,total_quantity:selected.reduce((sum,row)=>sum+row.effective_quantity,0),groups:Object.values(groups),documents:selected,coverage,queried_at:now()};
      }
      if(parts[1]==='reconciliation') {
        const items=objects(q).map(row=>{if(row.status!=='opened')return {...row,consistent:null,ledger_on_hand:null,ledger_reserved:null,reservation_remaining:null,documents_on_hand:null,documents_reserved:null};const ledgers=db.ledger.filter(l=>l.warehouse_id===row.warehouse.id&&l.model_id===row.model.id),documents=db.documents.filter(d=>d.warehouse.id===row.warehouse.id&&d.model.id===row.model.id),sum=(rows,f)=>rows.reduce((s,r)=>s+f(r),0),lh=sum(ledgers,l=>l.on_hand_delta),lr=sum(ledgers,l=>l.reserved_delta),rr=sum(row.reservations,r=>r.remaining_quantity),dh=sum(documents,d=>['opening','inbound','adjustment'].includes(d.kind)?d.effective_quantity:['outbound','pickup'].includes(d.kind)?-d.effective_quantity:0),dr=db.accounts[accountKey(row.warehouse.id,row.model.id)].opening_reserved+sum(documents,d=>d.kind==='reserve'?d.effective_quantity:['cancel','pickup'].includes(d.kind)?-d.effective_quantity:0);return {...row,ledger_on_hand:lh,ledger_reserved:lr,reservation_remaining:rr,documents_on_hand:dh,documents_reserved:dr,consistent:row.on_hand===lh&&lh===dh&&row.reserved===lr&&lr===rr&&rr===dr};});
        const opened=items.filter(row=>row.status==='opened');return {items,consistent:opened.length?opened.every(row=>row.consistent):null,queried_at:now()};
      }
    }
    fail(404,'未实现的模拟接口：'+method+' '+url.pathname);
  }
  async function request(path,method='GET',body) {return copy(route(path,method.toUpperCase(),body));}
  const api={request,reset,setScenario,getScenario:()=>scenario};reset();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.FrontendMock=api;
})(globalThis);
