// ANI Editor client script (runs inside webview)
(function(){
  try{
    const vscodeApi = acquireVsCodeApi();
    const dataEl = document.getElementById('ani-data');
    const payload = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
    const frames = Array.isArray(payload.frames) ? payload.frames : [];
    const availableTags = Array.isArray(payload.availableTags) ? payload.availableTags : [];

    function createTagDropdown(options, current){
      const wrapper = document.createElement('div'); wrapper.className='tag-select';
      const badge = document.createElement('span'); badge.className='tag-badge'; badge.textContent = '标签';
      const select = document.createElement('select'); select.className='combo tag';
      if(!current){
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '请选择标签';
        ph.disabled = true;
        ph.selected = true;
        select.appendChild(ph);
      }
      options.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; select.appendChild(o); });
      if(current && options.includes(current)) select.value = current;
      wrapper.appendChild(badge); wrapper.appendChild(select);
      return { wrapper, select, badge };
    }

    function normLines(s){ return String(s ?? '').replace(/\r\n|\r/g,'\n').split('\n').filter(_=>true); }
    function parseNums(val){ const m = String(val||'').match(/-?\d+(?:\.\d+)?/g) || []; return m.map(x=>x.includes('.')?parseFloat(x):parseFloat(x)); }
    function makeNumInput(value, opts){ const inp=document.createElement('input'); inp.type='number'; inp.className='search'; inp.style.minWidth='100px'; if(opts && opts.step!=null) inp.step=String(opts.step); if(opts && opts.min!=null) inp.min=String(opts.min); if(opts && opts.max!=null) inp.max=String(opts.max); inp.value = (Number.isFinite(value)? String(value):''); return inp; }

    function renderArray(ent, len, opts){
      const SEP='\t';
      const holder=document.createElement('div'); holder.style.display='flex'; holder.style.flexWrap='wrap'; holder.style.gap='8px';
      const nums = parseNums(ent.value);
      while(nums.length < len) nums.push(0);
      const labels = (opts && opts.labels) || [];
      function update(){ ent.value = nums.slice(0,len).map(v=>String(v)).join(SEP); }
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
      const s = String(val||'');
      // Prefer format: `key`<ws>id (ws can be tabs/newlines)
      const m = s.match(new RegExp(bt + '([\\s\\S]*?)' + bt + '\\s*([+-]?\\d+)'));
      if(m){
        return [{ key: m[1] || '', id: parseInt(m[2]) || 0 }];
      }
      // Fallback legacy two-line format
      const lines = normLines(s);
      if(lines.length >= 2){
        const k = (lines[0]||'').replace(new RegExp('^'+bt+'|'+bt+'$','g'),'');
        const id = parseInt((lines[1]||'').match(/-?\d+/)?.[0]||'0')||0;
        return [{ key:k, id }];
      }
      return [{ key:'', id:0 }];
    }

    function renderImagePairs(ent){
      const SEP='\t';
      const bt = String.fromCharCode(96);
      const wrap=document.createElement('div');
      wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.alignItems='stretch'; wrap.style.gap='6px';
      const first = parseImagePairs(ent.value)[0] || { key:'', id:0 };
      const k=document.createElement('textarea'); k.className='value';
      k.style.width='100%'; k.style.minHeight='56px'; k.style.boxSizing='border-box'; k.wrap='soft'; k.placeholder='图片键 (字符串)';
      k.value=first.key || '';
      const v=document.createElement('input'); v.type='number'; v.className='search'; v.style.minWidth='120px'; v.style.width='160px'; v.placeholder='帧ID'; v.value=String(first.id || 0);
      function autosize(){ k.style.height='auto'; k.style.height = Math.min(k.scrollHeight, 400) + 'px'; }
      function commit(){ const key = k.value || ''; const id = parseInt(v.value||'0')||0; ent.value = bt + key + bt + SEP + String(id); }
      k.addEventListener('input',()=>{ commit(); autosize(); });
      v.addEventListener('input',commit);
      wrap.appendChild(k); wrap.appendChild(v);
      autosize();
      if(!ent.value || String(ent.value).trim()===''){ commit(); }
      return wrap;
    }

  function updateCount(){ const el = document.getElementById('frameCount'); if(el) el.textContent = '共 ' + frames.length + ' 帧'; }
  function render(keepOpenForIdx, suppressDefaultOpen){
      const root=document.getElementById('frames'); if(!root) return;
      // collect previously open frames by data-idx
      const prevOpen = new Set();
      Array.from(root.querySelectorAll('details.frame')).forEach(function(det){
        try{
          if(det.open){ const idx = parseInt(det.getAttribute('data-idx')||''); if(!Number.isNaN(idx)) prevOpen.add(idx); }
        }catch(_){}
      });
      const forceIdx = (typeof keepOpenForIdx === 'number') ? keepOpenForIdx : null;
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
  det.open = (forceIdx !== null) ? (idx === forceIdx) : (prevOpen.size > 0 ? prevOpen.has(idx) : (!suppressDefaultOpen && (idx === 0)));
        det.addEventListener('toggle', ()=>{ if(det.open){ try{ vscodeApi.postMessage({ type:'focus-frame', idx }); }catch(_){} } });
        const sum=document.createElement('summary');
        const title=document.createElement('span'); title.className='title'; title.textContent='帧 ' + idx + ' (FRAME' + String(idx).padStart(3,'0') + ')';
        const actions=document.createElement('span'); actions.className='actions';
        const copyIcon=document.createElement('vscode-button'); copyIcon.title='复制该帧'; copyIcon.appearance='icon'; copyIcon.innerHTML='📄';
        const delIcon=document.createElement('vscode-button'); delIcon.title='删除该帧'; delIcon.appearance='icon'; delIcon.innerHTML='🗑️';
        copyIcon.addEventListener('click',(ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          try{ det.open = true; }catch(_){}
          // remove any existing copy bars
          document.querySelectorAll('.copyBar').forEach(el=>el.parentElement && el.parentElement.removeChild(el));
          const bar=document.createElement('div'); bar.className='copyBar';
          bar.style.display='flex'; bar.style.gap='8px'; bar.style.alignItems='center';
          bar.style.padding='6px 8px'; bar.style.margin='6px 0';
          bar.style.border='1px solid var(--vscode-input-border, rgba(255,255,255,0.15))';
          bar.style.background='var(--vscode-editor-background)';
          const lab=document.createElement('span'); lab.textContent='复制到序号';
          const inp=document.createElement('input'); inp.type='number'; inp.className='search'; inp.style.width='90px';
          inp.min='0'; inp.max=String(frames.length); inp.value=String(Math.min(idx+1, frames.length));
          const ok=document.createElement('vscode-button'); ok.textContent='确定';
          const cancel=document.createElement('vscode-button'); cancel.textContent='取消';
          ok.addEventListener('click',()=>{
            const val = parseInt((inp.value||'').trim());
            if(!Number.isFinite(val)) { bar.remove(); return; }
            let target = val; if(target < 0) target = 0; if(target > frames.length) target = frames.length;
            const cloned = JSON.parse(JSON.stringify(frames[idx]));
            cloned.idx = -1;
            frames.splice(target, 0, cloned);
            for(let i=0;i<frames.length;i++){ frames[i].idx = i; }
            render(target); updateCount();
          });
          cancel.addEventListener('click',()=>{ bar.remove(); });
          bar.appendChild(lab); bar.appendChild(inp); bar.appendChild(ok); bar.appendChild(cancel);
          // append at top of body
          if(body && body.firstChild) body.insertBefore(bar, body.firstChild); else if(body) body.appendChild(bar);
          try{ inp.focus(); inp.select(); }catch(_){}
        });
        delIcon.addEventListener('click',(ev)=>{
          ev.preventDefault(); ev.stopPropagation();
          frames.splice(idx,1);
          for(let i=0;i<frames.length;i++){ if(typeof frames[i].idx==='number') frames[i].idx=i; }
          render(null, true); updateCount();
        });
        actions.appendChild(copyIcon);
        actions.appendChild(delIcon);
        sum.appendChild(title); sum.appendChild(actions);
        const body=document.createElement('div'); body.className='body';

        (f.entries||[]).forEach((ent, i)=>{
          const box=document.createElement('div'); box.className='entry';
          const head=document.createElement('div'); head.className='head';
          const dd=createTagDropdown(availableTags, ent.tag);
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
          // Focus within control also hints current frame
          box.addEventListener('focusin',()=>{ try{ vscodeApi.postMessage({ type:'focus-frame', idx }); }catch(_){} });
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

  render(); updateCount();

    window.addEventListener('message', (e)=>{
      const d = e.data||{}; if(d.type==='update-frames'){ render(); }
    });

    const btnSave = document.getElementById('btnSave');
    const btnAddFrame = document.getElementById('btnAddFrame');
    btnSave && btnSave.addEventListener('click',()=>{ vscodeApi.postMessage({ type:'save', frames }); });
    btnAddFrame && btnAddFrame.addEventListener('click',()=>{ frames.push({ idx: frames.length, entries: [] }); render(frames.length - 1); updateCount(); });
    const btnAddMany = document.getElementById('btnAddMany');
    if(btnAddMany){
      const toolbar = btnAddMany.parentElement || document.querySelector('.toolbar');
      let bar = document.getElementById('bulkAddBar');
      if(!bar){
        bar = document.createElement('div'); bar.id='bulkAddBar';
        const lab=document.createElement('span'); lab.textContent='数量';
        const inp=document.createElement('input'); inp.type='number'; inp.min='1'; inp.value='1'; inp.className='search'; inp.style.width='80px';
        const ok=document.createElement('vscode-button'); ok.textContent='确定';
        const cancel=document.createElement('vscode-button'); cancel.textContent='取消';
        ok.addEventListener('click',()=>{ const n = parseInt((inp.value||'0').trim()); if(!Number.isFinite(n) || n<=0){ return; }
          for(let i=0;i<n;i++){ frames.push({ idx: frames.length, entries: [] }); }
          render(frames.length-1); updateCount(); bar.classList.remove('show'); });
        cancel.addEventListener('click',()=>{ bar.classList.remove('show'); });
        bar.appendChild(lab); bar.appendChild(inp); bar.appendChild(ok); bar.appendChild(cancel);
        if(toolbar) toolbar.appendChild(bar);
      }
      btnAddMany.addEventListener('click',()=>{
        const currentBar = document.getElementById('bulkAddBar');
        if(currentBar){ currentBar.classList.toggle('show'); const i = currentBar.querySelector('input'); if(i){ try{ i.focus(); i.select(); }catch(_){} } }
      });
    }
  }catch(e){
    const pre = document.createElement('pre');
    pre.style.color = 'var(--vscode-errorForeground)';
    pre.textContent = 'ANI 编辑器加载失败:\n' + (e && (e.stack||e.message||String(e)));
    document.body.appendChild(pre);
  }
})();
