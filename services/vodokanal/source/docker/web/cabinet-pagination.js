
(() => {
  "use strict";
  const ROWS = ".record,.lab-card,.inv-row,.wm-row,.wm-request,.wo-card,.wo-permit-row,.dispatch-record,.operations-card:not(form):not(.operations-error),.doc-row,.doc-version,.hyd-row,.pub-record,.sw-delivery";
  const READ_MORE = /^(?:Показать ещё|Показать еще|Загрузить ещё|Загрузить еще|Загрузить предыдущие|Загрузить следующие|Следующая страница|Следующие 25|Более ранние)/;
  function mount(root) {
    if (!root) return {destroy(){}};
    const doc=root.ownerDocument, states=new Map();let scheduled=false, destroyed=false;
    const owned=n=>n.closest?.("[data-cabinet-pagination]");
    const direct=(host,selector)=>[...host.children].filter(n=>n.matches(selector)&&!n.hidden);
    function key(host) {const parts=[];for(let n=host;n&&n!==root;n=n.parentElement){if(n.id){parts.unshift("#"+n.id);break;}parts.unshift(n.tagName+":"+[...n.parentElement.children].filter(c=>!owned(c)).indexOf(n));}return parts.join(">");}
    function candidates() {
      const found=new Map();
      for(const row of root.querySelectorAll(ROWS)) {
        if(row.closest("form") || row.matches(".operations-error"))continue;
        const host=row.parentElement;if(!found.has(host))found.set(host,()=>direct(host,ROWS));
      }
      for(const host of root.querySelectorAll("tbody,.record-list,.doc-list,.pub-admin-list,#lab-list,#lab-staff-list,.dispatch-network-object-list")) {
        if(host.closest("form")||host.closest(".cabinet-pagination"))continue;
        found.set(host,()=>host.tagName==="TBODY"?direct(host,"tr"):direct(host,ROWS+",li,article"));
      }
      for(const host of root.querySelectorAll(".sw-section ul,.sw-section ol,.wo-history ul,.wo-setup-history ul,.dispatch-history ul,.identity-transfer-list"))found.set(host,()=>direct(host,"li,article,.identity-letter"));
      for(const host of root.querySelectorAll(".dispatch-history"))found.set(host,()=>direct(host,"p"));
      for(const id of ["dispatch-directory-history-next","dispatch-crew-history-next","wo-setup-history-next"]) {
        const next=root.querySelector("#"+id),host=next?.previousElementSibling;
        if(host&&host.tagName==="DIV")found.set(host,()=>direct(host,id==="dispatch-crew-history-next"?"section":"p"));
      }
      return found;
    }
    function anchor(host) {const table=host.tagName==="TBODY"?host.closest("table"):null;return table ? table.closest(".table-scroll,.inv-table-wrap,.wo-table-scroll,.hyd-table-wrap,.sw-table-scroll,.doc-table-scroll,.dispatch-table-scroll")||table : host;}
    function continuation(host) {
      const point=anchor(host), choices=[];
      if(host.id)choices.push(...doc.querySelectorAll('[id="pages-'+host.id+'"] button'));
      if(point?.id)choices.push(...doc.querySelectorAll('[id="pages-'+point.id+'"] button'));
      const scan=n=>{if(!n)return;if(n.matches("button"))choices.push(n);else if(n.matches(".portal-page-controls,.sw-pager,.lab-toolbar,.inv-actions,.wm-actions,.wo-actions"))choices.push(...n.querySelectorAll("button"));};
      for(const n of host.children)scan(n);
      scan(point?.nextElementSibling);scan(point?.previousElementSibling?.matches(".sw-pager")?point.previousElementSibling:null);
      for(let n=point?.nextElementSibling,i=0;n&&i<3;i++,n=n.nextElementSibling){if(n.matches("h2,h3,h4,form,fieldset,section,table,.record-list"))break;scan(n);}
      for(let n=point?.previousElementSibling,i=0;n&&i<3;i++,n=n.previousElementSibling){if(n.matches("h2,h3,h4,form,fieldset,section,table,.record-list,.table-scroll,.inv-table-wrap,.wo-table-scroll"))break;scan(n);}
      if(host.matches("ul,ol")&&host.parentElement?.children.length<=2){scan(host.parentElement.nextElementSibling);scan(host.parentElement.previousElementSibling);}
      return [...new Set(choices)].find(n=>!n.hidden&&!n.closest("[hidden]")&&n.dataset.unavailable!=="true"&&READ_MORE.test(n.textContent.trim()))||null;
    }
    function busy(host,more) {return !!more?.disabled || !!host.closest('[aria-busy="true"]');}
    function create(host,getRows) {
      const nav=doc.createElement("nav");nav.className="cabinet-pagination";nav.dataset.cabinetPagination="true";
      nav.setAttribute("aria-label","Страницы списка");
      const status=doc.createElement("span");status.className="cabinet-pagination-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
      const buttons=doc.createElement("div");buttons.className="cabinet-page-numbers";
      const button=(text,action)=>{const n=doc.createElement("button");n.type="button";n.textContent=text;n.addEventListener("click",action);return n;};
      const s={host,getRows,nav,status,buttons,key:key(host),rows:[],keys:[],pages:[],index:0,more:null,pending:null,timer:null,seenBusy:false,signature:""};
      const previous=button("Назад",()=>go(s,s.index-1)),next=button("Далее",()=>go(s,s.index+1));s.previous=previous;s.next=next;
      nav.append(status,previous,buttons,next);states.set(host,s);return s;
    }
    function clearPending(s) {clearTimeout(s.timer);s.pending=null;s.seenBusy=false;}
    function go(s,index) {
      if(index<0||busy(s.host,s.more)||s.pending!==null)return;
      if(s.pages[index]){s.index=index;paint(s,true);return;}
      const start=s.pages.at(-1)?.end||0;
      if(start<s.rows.length){s.pages.push({start,end:Math.min(start+10,s.rows.length)});s.index=index;paint(s,true);return;}
      if(!s.more || s.more.disabled)return;
      s.pending=index;s.seenBusy=false;paint(s);s.more.click();
      s.timer=setTimeout(()=>{clearPending(s);paint(s);},30000);schedule();
    }
    function paint(s,focus=false) {
      const p=s.pages[s.index]||{start:0,end:0};
      s.rows.forEach((row,i)=>{const hide=i<p.start||i>=p.end;if(row.hasAttribute("data-cabinet-page-hidden")!==hide)row.toggleAttribute("data-cabinet-page-hidden",hide);});
      const visible=!s.host.closest("[hidden]")&&(s.rows.length>10||!!s.more||s.pages.length>1);
      if(s.nav.hidden===visible)s.nav.hidden=!visible;
      const locked=busy(s.host,s.more)||s.pending!==null;
      const previousDisabled=locked||s.index===0,nextDisabled=locked||(!s.pages[s.index+1]&&p.end>=s.rows.length&&!s.more);
      if(s.previous.disabled!==previousDisabled)s.previous.disabled=previousDisabled;
      if(s.next.disabled!==nextDisabled)s.next.disabled=nextDisabled;
      const signature=[s.index,s.pages.length,p.start,p.end,locked,s.rows.length].join(":");
      if(s.signature!==signature){s.signature=signature;s.status.textContent=s.rows.length?"Страница "+(s.index+1)+" · записи "+(p.start+1)+"-"+p.end:"";s.buttons.replaceChildren();
        for(let i=Math.max(0,s.index-2);i<Math.min(s.pages.length,s.index+3);i++){const n=doc.createElement("button");n.type="button";n.textContent=String(i+1);n.setAttribute("aria-label","Страница "+(i+1));if(i===s.index)n.setAttribute("aria-current","page");n.disabled=locked;n.addEventListener("click",()=>go(s,i));s.buttons.append(n);}}
      const point=anchor(s.host);if(point?.parentElement&&point.nextElementSibling!==s.nav)point.after(s.nav);
      if(focus&&visible){s.nav.scrollIntoView({block:"nearest"});s.buttons.querySelector('[aria-current="page"]')?.focus({preventScroll:true});}
    }
    function update(s) {
      const rows=s.getRows(),keys=rows.map(n=>n.id||n.dataset.id||n.textContent),oldLength=s.rows.length;
      const prefix=rows.length>=oldLength&&s.keys.every((key,i)=>key===keys[i]);
      if(!prefix||!rows.length){clearPending(s);s.pages=[];s.index=0;}
      s.rows=rows;s.keys=keys;if(!s.pages.length&&rows.length)s.pages.push({start:0,end:Math.min(10,rows.length)});
      const more=continuation(s.host);
      if(s.more&&s.more!==more)s.more.removeAttribute("data-cabinet-continuation");s.more=more;
      if(more&&!more.hasAttribute("data-cabinet-continuation"))more.dataset.cabinetContinuation="true";
      if(s.pending!==null){const locked=busy(s.host,more);if(locked)s.seenBusy=true;
        if(prefix&&rows.length>oldLength){const start=s.pages.at(-1)?.end||0;s.pages.push({start,end:Math.min(start+10,rows.length)});s.index=s.pending;clearPending(s);paint(s,true);return;}
        if(s.seenBusy&&!locked)clearPending(s);
      }
      paint(s);
    }
    function refresh() {
      scheduled=false;if(destroyed)return;const found=candidates();
      const replaced=new Map([...states.values()].filter(s=>!root.contains(s.host)).map(s=>[s.key,s]));
      for(const [host,getRows] of found)if(!states.has(host)){const previous=replaced.get(key(host));if(previous){states.delete(previous.host);previous.host=host;previous.getRows=getRows;states.set(host,previous);replaced.delete(previous.key);}}
      for(const [host,s] of states)if(!found.has(host)||!root.contains(host)){clearPending(s);s.rows.forEach(n=>n.removeAttribute("data-cabinet-page-hidden"));s.more?.removeAttribute("data-cabinet-continuation");s.nav.remove();states.delete(host);}
      for(const [host,getRows] of found){const s=states.get(host)||create(host,getRows);s.getRows=getRows;update(s);}
    }
    function schedule(){if(!scheduled&&!destroyed){scheduled=true;queueMicrotask(refresh);}}
    const observer=new MutationObserver(records=>{if(records.some(r=>!owned(r.target)&&([...r.addedNodes,...r.removedNodes].some(n=>n.nodeType!==1||!n.hasAttribute("data-cabinet-pagination"))||r.type==="attributes")))schedule();});
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden","disabled","aria-busy"]});refresh();
    return {refresh,destroy(){destroyed=true;observer.disconnect();for(const s of states.values()){clearPending(s);s.rows.forEach(n=>n.removeAttribute("data-cabinet-page-hidden"));s.more?.removeAttribute("data-cabinet-continuation");s.nav.remove();}states.clear();}};
  }
  globalThis.VodokanalPagination=Object.freeze({mount});
  const root=document.getElementById("application");if(root)mount(root);
})();
