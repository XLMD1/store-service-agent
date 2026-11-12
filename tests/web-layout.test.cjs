const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('电脑和手机切换只更新布局，不重建表单或发起请求，后续页面保留手动模式',()=>{
  let renders=0,markup='';
  const workspace={dataset:{}},desktop={setAttribute(){}},mobile={setAttribute(){}};
  const app={set innerHTML(value){markup=value;renders++;}};
  const context=vm.createContext({module:{exports:{}},location:{hash:'#inventory'},window:{scrollTo(){},matchMedia:()=>({matches:true})},
    document:{querySelector:selector=>({'#app':app,'#workspace':workspace,'#view-desktop':desktop,'#view-mobile':mobile,'#logout':{}}[selector]),querySelectorAll:()=>[]},
    fetch(){throw new Error('页面模式切换不应发起请求');}});
  vm.runInContext(['movements','app'].map(name=>fs.readFileSync(require.resolve('../app/web/'+name+'.js'),'utf8')).join('\n'),context);
  vm.runInContext(`state.user={username:'样例',permissions:['inventory.read']};shell('库存','','<form>正在填写的表单</form>');`,context);
  assert.equal(typeof mobile.onclick,'function');assert.equal(workspace.dataset.view,'desktop');
  assert.doesNotMatch(markup,/href="#catalog"|href="#opening"|href="#inbound"|href="#customers"/);
  mobile.onclick();assert.equal(workspace.dataset.view,'mobile');assert.equal(renders,1);
  assert.match(markup,/正在填写的表单/);
  desktop.onclick();assert.equal(workspace.dataset.view,'desktop');assert.equal(renders,1);
  mobile.onclick();vm.runInContext(`shell('流水','','下一页');`,context);
  assert.equal(workspace.dataset.view,'mobile');assert.equal(renders,2);
});
