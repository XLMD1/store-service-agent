'use strict';
const FormState = {
  async freezeWhile(form, action) {
    const controls = [...form.querySelectorAll('input,select,textarea,button')];
    const previous = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { return await action(); }
    finally { controls.forEach((control,index) => { control.disabled = previous[index]; }); }
  }
};
if (typeof module !== 'undefined') module.exports = FormState;
