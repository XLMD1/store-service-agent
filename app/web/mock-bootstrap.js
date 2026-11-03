/* Demo controls are outside routed pages so error states remain recoverable. */
'use strict';
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#demo-scenario').addEventListener('change',async event=>{
    FrontendMock.setScenario(event.target.value);
    if(event.target.value==='empty'){FrontendMock.reset();state.user=null;document.querySelector('#demo-role').value='owner';location.hash='inventory';}
    await render();
    notify('已切换接口场景：'+event.target.selectedOptions[0].textContent);
  });
  document.querySelector('#demo-role').addEventListener('change',async event=>{
    try{state.user=await FrontendMock.request('/auth/login','POST',{username:'demo-'+event.target.value,password:'demo'});await render();}
    catch(error){event.target.value=state.user?.roles[0]||'owner';FrontendPickers.refresh();notify(error.message);}
  });
  document.querySelector('#demo-reset').addEventListener('click',async()=>{
    FrontendMock.setScenario('normal');FrontendMock.reset();resetServiceMock();
    document.querySelector('#demo-scenario').value='normal';document.querySelector('#demo-role').value='owner';
    state.user=null;location.hash='home';await render();FrontendPickers.refresh();notify('演示数据已重置。');
  });
});
