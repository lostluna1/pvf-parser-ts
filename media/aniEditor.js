// ANI Editor client script (runs inside webview)
(function(){
  try{
    const vscodeApi = acquireVsCodeApi();
    const dataEl = document.getElementById('ani-data');
    const payload = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
    const frames = Array.isArray(payload.frames) ? payload.frames : [];
    const availableTags = Array.isArray(payload.availableTags) ? payload.availableTags : [];

    function createTagDropdown(options){
      const wrapper = document.createElement('div');
      const select = document.createElement('select'); select.className='combo';
      options.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; select.appendChild(o); });
      wrapper.appendChild(select);
      return { wrapper, select };
    }

    function normLines(s){ return String(s ?? '').replace(/\r\n|\r/g,'\n').split('\n').filter(_=>true); }
    function parseNums(val){ const m = String(val||'').match(/-?\d+(?:\.\d+)?/g) || []; return m.map(x=>x.includes('.')?parseFloat(x):parseFloat(x)); }
    function makeNumInput(value, opts){ const inp=document.createElement('input'); inp.type='number'; inp.className='search'; inp.style.minWidth='100px'; if(opts && opts.step!=null) inp.step=String(opts.step); if(opts && opts.min!=null) inp.min=String(opts.min); if(opts && opts.max!=null) inp.max=String(opts.max); inp.value = (Number.isFinite(value)? String(value):''); return inp; }

    function renderArray(ent, len, opts){
      const CRLF='\r\n';
      const holder=document.createElement('div'); holder.style.display='flex'; holder.style.flexWrap='wrap'; holder.style.gap='8px';
      const nums = parseNums(ent.value);
      while(nums.length < len) nums.push(0);
      const labels = (opts && opts.labels) || [];
      function update(){ ent.value = nums.slice(0,len).map(v=>String(v)).join(CRLF); }
      for(let k=0;k<len;k++){
        const wrap=document.createElement('div'); wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.gap='4px';
        if(labels[k]){ const lab=document.createElement('div'); lab.textContent=labels[k]; lab.style.fontSize='12px'; lab.style.opacity='0.8'; wrap.appendChild(lab); }
        const inp=makeNumInput(nums[k], { step: (opts && opts.float)? 0.01: 1, min: (opts && opts.min), max: (opts && opts.max) });
        inp.addEventListener('input',()=>{ const v = inp.value === '' ? 0 : ((opts && opts.float)? parseFloat(inp.value): parseInt(inp.value)); nums[k] = Number.isFinite(v)? v : 0; update(); });
        wrap.appendChild(inp); holder.appendChild(wrap);
      }
      if(!ent.value || String(ent.value).trim()==='') { update(); }
      return holder;
    }

    function renderBool(ent){
      const wrap=document.createElement('div'); wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='8px';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked = String(ent.value||'').trim() === '1';
      const lab=document.createElement('span'); lab.textContent='启用 (1/0)';
      cb.addEventListener('change',()=>{ ent.value = cb.checked ? '1' : '0'; });
      wrap.appendChild(cb); wrap.appendChild(lab); return wrap;
    }

    function renderDropdown(ent, options){
      const sel=document.createElement('select'); sel.className='combo';
      const cur=(String(ent.value||'').trim());
      const opts=['', ...options];
      opts.forEach(op=>{ const o=document.createElement('option'); o.value=op; o.textContent=op||'(空)'; sel.appendChild(o); });
      if(opts.includes(cur)) sel.value = cur;
      sel.addEventListener('change',()=>{ ent.value = sel.value; });
      return sel;
    }

    function renderText(ent, singleLine){
      if(singleLine){
        const inp=document.createElement('input'); inp.type='text'; inp.className='search'; inp.style.minWidth='320px'; inp.value=(normLines(ent.value).join(' ').trim());
        inp.addEventListener('input',()=>{ ent.value = inp.value; }); return inp;
      } else {
        const area=document.createElement('textarea'); area.className='value'; area.value = ent.value || '';
        area.addEventListener('input',()=>{ ent.value = area.value; }); return area;
      }
    }

    function parseImagePairs(val){
      const bt = String.fromCharCode(96);
      const lines = normLines(val).filter(l=>l!=='' || true);
      const pairs=[];
      for(let p=0; p<lines.length; p+=2){
        const k = (lines[p]||'').replace(new RegExp('^'+bt+'|'+bt+'$','g'),'');
        const idLine = lines[p+1]||''; const id = parseInt((idLine.match(/-?\d+/)||['0'])[0]);
        if(k!=='' || Number.isFinite(id)) pairs.push({ key:k, id: Number.isFinite(id)? id: 0 });
      }
      return pairs;
    }

    function renderImagePairs(ent){
      const CRLF='\r\n';
      const bt = String.fromCharCode(96);
      const wrap=document.createElement('div'); wrap.style.display='flex'; wrap.style.gap='6px'; wrap.style.alignItems='center';
      const first = parseImagePairs(ent.value)[0] || { key:'', id:0 };
      const k=document.createElement('input'); k.type='text'; k.className='search'; k.style.minWidth='260px'; k.placeholder='图片键 (字符串)'; k.value=first.key || '';
      const v=document.createElement('input'); v.type='number'; v.className='search'; v.style.minWidth='100px'; v.placeholder='帧ID'; v.value=String(first.id || 0);
      function commit(){ const key = k.value || ''; const id = parseInt(v.value||'0')||0; ent.value = bt + key + bt + CRLF + String(id); }
      k.addEventListener('input',commit);
      v.addEventListener('input',commit);
      wrap.appendChild(k); wrap.appendChild(v);
      if(!ent.value || String(ent.value).trim()===''){ commit(); }
      return wrap;
    }

    function render(keepOpenForIdx){
      const root=document.getElementById('frames'); if(!root) return;
      // collect previously open frames by data-idx
      const prevOpen = new Set();
      Array.from(root.querySelectorAll('details.frame')).forEach(function(det){
        try{
          if(det.open){ const idx = parseInt(det.getAttribute('data-idx')||''); if(!Number.isNaN(idx)) prevOpen.add(idx); }
        }catch(_){}
      });
      if(typeof keepOpenForIdx === 'number') prevOpen.add(keepOpenForIdx);
      root.innerHTML='';
      if(!Array.isArray(frames) || frames.length===0){
        const empty=document.createElement('div');
        empty.style.opacity='0.7';
        empty.style.padding='8px 4px';
        empty.textContent='未解析到任何帧。请检查 ANI 格式，或点击上方“新增帧”。';
        root.appendChild(empty);
        return;
      }
      frames.forEach((f,idx)=>{
        const det=document.createElement('details'); det.className='frame'; det.setAttribute('data-idx', String(idx));
        det.open = prevOpen.size > 0 ? prevOpen.has(idx) : (idx === 0);
        const sum=document.createElement('summary'); sum.textContent='帧 ' + idx + ' (FRAME' + String(idx).padStart(3,'0') + ')';
        const body=document.createElement('div'); body.className='body';

        (f.entries||[]).forEach((ent, i)=>{
          const box=document.createElement('div'); box.className='entry';
          const head=document.createElement('div'); head.className='head';
          const dd=createTagDropdown(availableTags);
          dd.select.value = ent.tag;
          const btnDel=document.createElement('vscode-button'); btnDel.textContent='删除';
          btnDel.addEventListener('click',()=>{ f.entries.splice(i,1); render(idx); });
          head.appendChild(dd.wrapper); head.appendChild(btnDel);

          const TAG = (ent.tag||'').toUpperCase().trim();
          let valueControl;
          switch(TAG){
            case 'IMAGE': valueControl = renderImagePairs(ent); break;
            case 'IMAGE POS': valueControl = renderArray(ent, 2, { float:false, labels:['X','Y'] }); break;
            case 'DELAY': valueControl = (function(){ const n = parseNums(ent.value)[0] ?? 0; const inp=makeNumInput(n,{step:1}); inp.addEventListener('input',()=>{ ent.value = inp.value === '' ? '' : String(parseInt(inp.value)); }); return inp; })(); break;
            case 'ATTACK BOX':
            case 'DAMAGE BOX': valueControl = renderArray(ent, 6, { float:false }); break;
            case 'LOOP':
            case 'SHADOW':
            case 'COORD':
            case 'INTERPOLATION': valueControl = renderBool(ent); break;
            case 'IMAGE RATE': valueControl = renderArray(ent, 2, { float:true, labels:['RateX','RateY'] }); break;
            case 'IMAGE ROTATE': valueControl = (function(){ const n = parseNums(ent.value)[0] ?? 0; const inp=makeNumInput(n,{step:0.1}); inp.addEventListener('input',()=>{ ent.value = inp.value === '' ? '' : String(parseFloat(inp.value)); }); return inp; })(); break;
            case 'RGBA': valueControl = renderArray(ent, 4, { float:false, min:0, max:255, labels:['R','G','B','A'] }); break;
            case 'GRAPHIC EFFECT': valueControl = renderDropdown(ent, ['`LINEARDODGE`']); break;
            case 'DAMAGE TYPE': valueControl = renderDropdown(ent, ['`NORMAL`']); break;
            case 'PLAY SOUND':
            case 'PRELOAD':
            case 'SPECTRUM': valueControl = renderText(ent, true); break;
            case 'SET FLAG':
            case 'FLIP TYPE':
            case 'LOOP START':
            case 'LOOP END':
            case 'CLIP': valueControl = (function(){ const n = parseNums(ent.value)[0] ?? 0; const inp=makeNumInput(n,{step:1}); inp.addEventListener('input',()=>{ ent.value = inp.value === '' ? '' : String(parseInt(inp.value)); }); return inp; })(); break;
            case 'OPERATION': valueControl = renderText(ent, false); break;
            default: valueControl = renderText(ent, false); break;
          }

          dd.select.addEventListener('change',()=>{ ent.tag = dd.select.value; render(idx); });
          box.appendChild(head); box.appendChild(valueControl);
          body.appendChild(box);
        });

  const addRow=document.createElement('div'); addRow.className='tag-row';
  const dd=createTagDropdown(availableTags);
  const btnAdd=document.createElement('vscode-button'); btnAdd.textContent='添加标签';
  btnAdd.addEventListener('click',()=>{ const tag=dd.select.value||''; if(!tag) return; f.entries = f.entries||[]; f.entries.push({ tag, value: '' }); render(idx); });
        addRow.appendChild(dd.wrapper); addRow.appendChild(btnAdd);

        body.appendChild(addRow);
        det.appendChild(sum); det.appendChild(body);
        const root=document.getElementById('frames'); root && root.appendChild(det);
      });
    }

    render();

    window.addEventListener('message', (e)=>{
      const d = e.data||{}; if(d.type==='update-frames'){ render(); }
    });

    const btnSave = document.getElementById('btnSave');
    const btnAddFrame = document.getElementById('btnAddFrame');
    btnSave && btnSave.addEventListener('click',()=>{ vscodeApi.postMessage({ type:'save', frames }); });
  btnAddFrame && btnAddFrame.addEventListener('click',()=>{ frames.push({ idx: frames.length, entries: [] }); render(frames.length - 1); });
  }catch(e){
    const pre = document.createElement('pre');
    pre.style.color = 'var(--vscode-errorForeground)';
    pre.textContent = 'ANI 编辑器加载失败:\n' + (e && (e.stack||e.message||String(e)));
    document.body.appendChild(pre);
  }
})();
