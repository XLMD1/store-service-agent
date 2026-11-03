/* Shared searchable selectors; native selects remain the form data source. */
'use strict';
(function(root){
  const pickers=new Set();let serial=0;
  function enhance(select){
    if(select.multiple||select.dataset.pickerReady||select.closest('[data-native-select]'))return;
    select.dataset.pickerReady='true';
    const required=select.required;select.required=false;select.hidden=true;
    const field=select.closest('label,.field'),caption=select.getAttribute('aria-label')||field?.querySelector('span,label')?.textContent.trim()||'选项';
    const wrapper=document.createElement('div');wrapper.className='inventory-picker enhanced-picker';
    const control=document.createElement('div');control.className='picker-control';
    const input=document.createElement('input');input.type='text';input.id='picker-input-'+(++serial);input.autocomplete='off';input.required=required;input.setAttribute('role','combobox');input.setAttribute('aria-label',caption);input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
    const trigger=document.createElement('button');trigger.type='button';trigger.className='picker-trigger';trigger.setAttribute('aria-label','选择'+caption);trigger.title='选择'+caption;
    const triggerLabel=document.createElement('span');triggerLabel.className='picker-toggle-label';triggerLabel.textContent='选择'+caption.replace(/（.*?）/g,'');trigger.append(triggerLabel);
    trigger.insertAdjacentHTML('beforeend','<svg class="icon" aria-hidden="true"><use href="/web/assets/icons.svg#chevron"></use></svg>');
    const menu=document.createElement('div');menu.id='picker-menu-'+serial;menu.className='picker-choices';menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',caption+'选项');
    input.setAttribute('aria-controls',menu.id);trigger.setAttribute('aria-controls',menu.id);trigger.setAttribute('aria-expanded','false');
    const label=select.id&&document.querySelector('label[for="'+select.id+'"]');if(label)label.htmlFor=input.id;
    select.after(wrapper);control.append(input,trigger);wrapper.append(control,menu);
    let buttons=[];
    const close=focus=>{menu.hidden=true;input.setAttribute('aria-expanded','false');trigger.setAttribute('aria-expanded','false');if(focus&&trigger.isConnected)trigger.focus();};
    const sync=()=>{const option=select.options[select.selectedIndex];input.value=select.value&&option?option.textContent:'';input.placeholder=select.options[0]?.textContent||'请选择';input.disabled=trigger.disabled=select.disabled;input.setCustomValidity('');};
    const choose=index=>{const option=select.options[index];if(!option||option.disabled)return;select.value=option.value;sync();close(true);select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));};
    const open=filter=>{
      for(const picker of pickers)if(picker.select!==select)picker.close(false);
      for(const id of ['warehouse','model']){const list=document.getElementById(id+'-choices'),button=document.getElementById(id+'-toggle');if(list){list.hidden=true;button?.setAttribute('aria-expanded','false');}}
      menu.replaceChildren();buttons=[];const list=document.createElement('div');list.className='candidate-list';
      [...select.options].forEach((option,index)=>{
        if(option.disabled||filter&&!option.textContent.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))return;
        const button=document.createElement('button');button.type='button';button.textContent=option.textContent;button.setAttribute('role','option');button.setAttribute('aria-selected',String(select.selectedIndex===index));button.addEventListener('click',()=>choose(index));
        button.addEventListener('keydown',event=>{const at=buttons.indexOf(button);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});
        buttons.push(button);list.append(button);
      });
      if(!buttons.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='没有匹配选项，请修改文字或展开完整列表。';menu.append(empty);}else menu.append(list);
      menu.hidden=false;input.setAttribute('aria-expanded','true');trigger.setAttribute('aria-expanded','true');
    };
    trigger.addEventListener('click',()=>{if(menu.hidden)open('');else close(false);});
    trigger.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});
    input.addEventListener('input',()=>{const typed=input.value;select.value='';const matches=[...select.options].filter(option=>!option.disabled&&option.value&&option.textContent===input.value.trim());if(matches.length===1)select.value=matches[0].value;select.dispatchEvent(new Event('change',{bubbles:true}));input.value=typed;input.setCustomValidity(input.value&&!select.value?'请从列表选定具体选项。':'');open(input.value);});
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();if(menu.hidden)open(input.value);buttons[0]?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}if(event.key==='Enter'&&!menu.hidden){event.preventDefault();if(buttons.length===1)buttons[0].click();}});
    select.addEventListener('change',sync);select.addEventListener('input',sync);
    select.form?.addEventListener('reset',()=>queueMicrotask(sync));
    sync();pickers.add({select,wrapper,trigger,sync,close});
  }
  function refresh(container=document){container.querySelectorAll('select').forEach(enhance);for(const picker of pickers){if(!picker.select.isConnected)pickers.delete(picker);else picker.sync();}}
  function start(){refresh();const observer=new MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){for(const picker of pickers)if(picker.select===record.target)picker.sync();}else if(record.target.tagName==='SELECT'||record.target.tagName==='OPTION'){for(const picker of pickers)if(picker.select===record.target||picker.select.contains(record.target))picker.sync();}else for(const node of record.addedNodes)if(node.nodeType===1){if(node.tagName==='SELECT')enhance(node);else node.querySelectorAll('select').forEach(enhance);}}for(const picker of pickers)if(!picker.select.isConnected)pickers.delete(picker);});observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    document.addEventListener('pointerdown',event=>{for(const picker of pickers)if(!picker.wrapper.contains(event.target))picker.close(false);});
  }
  root.FrontendPickers={enhance,refresh,start};
  if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();}
})(typeof window==='undefined'?globalThis:window);
