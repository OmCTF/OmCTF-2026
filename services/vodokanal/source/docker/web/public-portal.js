
(() => {
  "use strict";
  const PUBLIC = "/public-portal/hs/portal/v1/", DISPATCH = "/public-dispatch/hs/dispatch/v1/", LAB = "/public/hs/lab/v1/";
  const LAKES = {danilovo:"Данилово",lenyovo:"Ленёво",shchuchye:"Щучье",shaitan:"Шайтан"};
  const KINDS = {announcement:"Объявления",tariff:"Тарифы",rules:"Правила работы",faq:"Вопросы и ответы",service:"Услуги"};
  const INDICATORS = {ph:"pH",turbidity:"Мутность",appearance:"Внешний вид",temperature:"Температура"};
  const TYPES = {Planned:"Плановые работы",Emergency:"Аварийное отключение"}, STATES = {Planned:"Запланировано",Active:"Действует",Restored:"Восстановлено"};
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, DAY = 86400000;
  const fault = (code = "некорректно_ответ", details = {}) => Object.assign(new Error(code), {code, ...details});
  function text(v, max = 8000) { if (typeof v !== "string" || v.length > max) throw fault(); return v; }
  function obj(v) { if (!v || typeof v !== "object" || Array.isArray(v)) throw fault(); return v; }
  function list(v, max = 100) { if (!Array.isArray(v) || v.length > max) throw fault(); return v; }
  function integer(v, min = 0, max = 1000000) { if (!Number.isInteger(v) || v < min || v > max) throw fault(); return v; }
  function id(v) { if (!UUID.test(text(v, 36))) throw fault(); return v; }
  function date(v, optional = false) { if (optional && v === "") return ""; if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text(v, 20)) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,19) + "Z" !== v) throw fault(); return v; }
  function labDate(v) { text(v,20); return date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)?v+"Z":v); }
  function stamp(v) { return date(v, true) ? new Date(v).toLocaleString("ru-RU", {timeZone:"UTC"}) + " UTC" : "Не указано"; }
  function decimal(v) { if (!/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(text(v, 32))) throw fault(); return v; }
  function page(raw, convert, previous = "") {
    obj(raw); const values = list(raw.items).map(convert); integer(raw.limit, 1, 100);
    const cursor = text(raw.nextCursor, 2000);
    if (typeof raw.hasMore !== "boolean" || values.length > raw.limit || (raw.hasMore ? !values.length || !cursor || cursor === previous : cursor !== "")) throw fault();
    return {items:values,hasMore:raw.hasMore,nextCursor:cursor,snapshotAt:date(raw.snapshotAt)};
  }
  async function request(base, path, options = {}) {
    if (!/^[a-z][a-z0-9/-]*(?:\?[^#]*)?$/.test(path)) throw fault("некорректно_запрос");
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 20000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      const response = await fetch(base + path, {method:options.method || "GET", credentials:"omit", cache:"no-store", redirect:"error", signal,
        headers:{Accept:"application/json", ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {})},
        body:options.body ? JSON.stringify(options.body) : undefined});
      if (!/application\/json/i.test(response.headers.get("content-type") || "")) throw fault("Недоступно", {status:response.status});
      const body = await response.text(); if (body.length > 2 * 1024 * 1024) throw fault();
      let value; try { value = JSON.parse(body); } catch { throw fault(); }
      if (!response.ok) throw fault(text(typeof value.error === "object" ? value.error.code : value.error || "Недоступно", 150), {status:response.status, requestId:typeof value.requestId === "string" ? value.requestId.slice(0,100) : "", retryAfter:response.headers.get("retry-after")});
      return value;
    } catch (error) { if (options.signal?.aborted) throw error; if (timeout.signal.aborted) throw fault("Превышено время ожидания"); throw error; }
    finally { clearTimeout(timer); }
  }
  function entry(raw) {
    obj(raw); const value = {id:id(raw.id),key:text(raw.key,64),kind:text(raw.kind,16),version:integer(raw.version,1),state:text(raw.state,16),title:text(raw.title,200),body:text(raw.body),details:obj(raw.details),validFrom:date(raw.validFrom),validTo:date(raw.validTo,true),publishedAt:date(raw.publishedAt),updatedAt:date(raw.updatedAt)};
    if (!Object.hasOwn(KINDS,value.kind) || !["Published","Archived"].includes(value.state)) throw fault();
    if (value.kind === "service") {
      const d = value.details; list(d.applicants,2); list(d.documents,12).forEach(v=>text(v,250)); decimal(d.price); text(d.priceUnit,60);
      if (!d.applicants.length || d.applicants.some(v=>!["resident","organization"].includes(v)) || !["portal","local"].includes(d.execution) || !["lab","meter","request","water","hazard"].includes(d.flow) || !["water","meter","lab","report"].includes(d.category)) throw fault();
    } else if (value.kind === "tariff") { decimal(value.details.amount); text(value.details.unit,60); }
    return value;
  }
  function outage(raw) {
    obj(raw); const value = {id:id(raw.id),type:text(raw.type,16),state:text(raw.state,16),reason:text(raw.reason,2000),addresses:list(raw.addresses,200).map(v=>text(v,250)),
      startedAt:date(raw.startedAt),expectedRestoredAt:date(raw.expectedRestoredAt,true),restoredAt:date(raw.restoredAt,true),updatedAt:date(raw.updatedAt),revision:integer(raw.revision,1),
      waterPoints:list(raw.waterPoints,100).map(v=>({address:text(v.address,250),from:date(v.from),to:date(v.to),note:text(v.note,1000)}))};
    if (!Object.hasOwn(TYPES,value.type) || !Object.hasOwn(STATES,value.state)) throw fault(); return value;
  }
  function mount({root}) {
    const doc = root.ownerDocument, el = (tag, className = "", value) => { const n = doc.createElement(tag); n.className = className; if (value !== undefined) n.textContent = value; return n; };
    const button = (label, fn, primary = false) => { const n = el("button", primary ? "pub-primary" : "", label); n.type = "button"; n.addEventListener("click", fn); return n; };
    const link = (label, href) => { const n = el("a", "", label); n.href = href; return n; };
    const section = (name,title,intro) => { const n = el("section","pub-section"); n.id = name; n.append(el("h2","",title)); if (intro) n.append(el("p","pub-intro",intro)); root.append(n); return n; };
    const status = host => { const n = el("p","pub-status"); n.setAttribute("role","status"); n.setAttribute("aria-live","polite"); host.append(n); return n; };
    const setStatus = (node, message, error = false) => { node.textContent = message; node.classList.toggle("error", error); };
    const field = (host, label, name, type = "text", options) => { const wrapper = el("div","pub-field"), caption = el("label","",label), input = el(type === "select" ? "select" : "input"); input.id = name; caption.htmlFor = name; if (type !== "select") input.type = type;
      if (options) for (const [value,label] of options) { const o = el("option","",label); o.value = value; input.append(o); } wrapper.append(caption,input); host.append(wrapper); return input; };
    const definition = (host,pairs) => { const dl = el("dl","pub-definition"); for (const [k,v] of pairs) dl.append(el("dt","",k),el("dd","",v)); host.append(dl); };
    const errorLabel = error => error.status === 429 ? "Слишком много запросов. Подождите" + (/^\d{1,5}$/.test(error.retryAfter || "") ? " " + error.retryAfter + " с" : " немного") + " и повторите." : error.code === "Превышено время ожидания" ? "Сервер не ответил вовремя. Можно повторить загрузку." : error.code === "некорректно_ответ" ? "Получены неполные данные. Они не показаны. Повторите загрузку или сообщите службе." : "Не удалось загрузить данные. Это не означает, что отключений или исследований нет. Повторите запрос.";
    function period(from,to) { const first = Date.parse(from.value + "T00:00:00Z"), last = Date.parse(to.value + "T00:00:00Z") + DAY;
      if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last || first < Date.UTC(2000,0,1) || last - first > 366 * DAY) throw fault("некорректно_период");
      return {from:new Date(first).toISOString().slice(0,19)+"Z",to:new Date(last).toISOString().slice(0,19)+"Z"}; }
    function dates(host,prefix,days = 29) { const from = field(host,"С даты (UTC)",prefix+"-from","date"), to = field(host,"По дату включительно (UTC)",prefix+"-to","date"), now = Date.now();
      from.value = new Date(now - days*DAY).toISOString().slice(0,10); to.value = new Date(now).toISOString().slice(0,10); from.min = to.min = "2000-01-01"; return {from,to}; }
    function pager(host, base, resource, convert, render, getParams, emptyMessage) {
      const size = 10, message = status(host), meta = el("p","pub-meta"), items = el("ul","pub-list"), actions = el("div","pub-actions"), navigation = el("nav","pub-pagination"), numbers = el("div","pub-page-numbers");
      navigation.setAttribute("aria-label","Страницы: "+(resource==="addresses" ? "Адреса" : host.closest("section")?.querySelector("h2")?.textContent || "список"));
      meta.setAttribute("role","status");meta.setAttribute("aria-live","polite");
      items.tabIndex = -1;
      const previous = button("Назад",()=>go(current-1)), next = button("Далее",()=>go(current+1)), retry = button("Повторить загрузку",()=>go(retryPage));
      navigation.hidden = retry.hidden = true; navigation.append(previous,numbers,next); actions.append(retry); host.append(meta,message,items,navigation,actions);
      let generation = 0, controller, pages = [], current = -1, retryPage = 0, params = null, busy = false;
      function controls() {
        navigation.hidden = current < 0 || !pages[current].items.length;
        previous.disabled = busy || current <= 0; next.disabled = busy || current < 0 || !pages[current].hasMore;
        numbers.replaceChildren();
        if(navigation.hidden)return;
        const start = Math.max(0,current-2), end = Math.min(pages.length,start+5);
        for (let index=start;index<end;index++) {
          const control = button(String(index+1),()=>go(index)); control.setAttribute("aria-label","Страница "+(index+1));
          if(index===current)control.setAttribute("aria-current","page");
          control.disabled=busy; numbers.append(control);
        }
      }
      function clear() { generation++;controller?.abort();pages=[];current=-1;params=null;retryPage=0;busy=false;items.replaceChildren();navigation.hidden=retry.hidden=true;meta.textContent="";setStatus(message,"");host.removeAttribute("aria-busy"); }
      function show(index, focus, nodes=pages[index].items.map(render)) {
        const result=pages[index], offset=pages.slice(0,index).reduce((sum,p)=>sum+p.items.length,0);
        current=index;items.replaceChildren(...nodes);retry.hidden=true;
        items.setAttribute("aria-label","Записи, страница "+(index+1));
        meta.textContent=result.items.length ? "Страница "+(index+1)+" · записи "+(offset+1)+"-"+(offset+result.items.length) : "";
        setStatus(message,result.items.length ? "" : emptyMessage);controls();
        if(focus){items.focus({preventScroll:true});items.scrollIntoView({block:"start"});}
      }
      async function go(target = 0, reset = false) {
        if (busy && !reset) return;
        if (reset) clear();
        let currentParams;
        try { currentParams = getParams(); } catch { clear();setStatus(message,"Проверьте даты: начало не позже окончания, период до 366 суток.",true);return; }
        if (target > 0 && (!params || JSON.stringify(currentParams) !== JSON.stringify(params))) { clear();setStatus(message,"Параметры изменены. Загрузите список заново.");return; }
        if (params && JSON.stringify(currentParams)!==JSON.stringify(params)) { clear();target=0; }
        if (!Number.isInteger(target) || target<0 || target>pages.length || (target>0&&!pages[target-1]?.hasMore)) return;
        params = currentParams;
        if(pages[target]){show(target,true);return;}
        const token = ++generation, requestCursor = target ? pages[target-1].nextCursor : "";
        controller?.abort(); controller = new AbortController(); busy = true;
        retry.hidden = true; host.setAttribute("aria-busy","true");controls();setStatus(message,"Загружаем опубликованные данные…");
        try {
          const query = new URLSearchParams({...params,limit:String(size),...(requestCursor ? {cursor:requestCursor} : {})}).toString().replace(/\+/g,"%20");
          const result = page(await request(base,resource+"?"+query,{signal:controller.signal}),convert,requestCursor);
          if (token !== generation) return;
          if(result.items.length>size || (target>0&&!result.items.length) || (result.hasMore&&pages.some(p=>p.nextCursor===result.nextCursor)))throw fault();
          const key = item => item.id || item.address, known = new Set(pages.flatMap(p=>p.items.map(key))), fresh = new Set();
          for (const item of result.items) { if (known.has(key(item)) || fresh.has(key(item))) throw fault(); fresh.add(key(item)); }
          const nodes=result.items.map(render);pages.push(result);show(target,!reset,nodes);
        } catch (error) { if (token !== generation) return; retryPage = target; retry.hidden = false; setStatus(message,errorLabel(error)+(error.requestId ? " Код обращения: "+error.requestId : ""),true); }
        finally { if (token === generation) { busy=false;host.removeAttribute("aria-busy");controls(); } }
      }
      return {load:()=>go(0,true),clear,message};
    }
    function filterEdits(inputs, invalidate) { for (const input of inputs) for (const event of ["input","change"]) input.addEventListener(event,invalidate); }
    root.replaceChildren();
    if (!root.parentElement?.querySelector(".landing-hero")) { const intro = el("div","pub-intro"); intro.append(el("h1","","Омский Водоканал"),el("p","","Отключения, услуги и качество воды в Омске.")); root.append(intro); }
    const summaryHost = el("div"), summaryStatus = status(summaryHost), summaryRetry = button("Обновить сведения портала",loadSummary); summaryHost.append(summaryRetry); root.append(summaryHost);
    async function loadSummary() { summaryRetry.disabled=true; setStatus(summaryStatus,"Загружаем сведения портала…"); try { const data = obj(await request(PUBLIC,"summary")); text(data.title,200); date(data.generatedAt); text(data.warning,1000); setStatus(summaryStatus,"Сведения обновлены: "+stamp(data.generatedAt)); } catch(error){setStatus(summaryStatus,errorLabel(error),true);}finally{summaryRetry.disabled=false;} }
    const quick = el("ul","pub-quick"); for (const [label,href] of [["Передать показания","/login?service=meter&applicant=resident"],["Сообщить о проблеме","/login?service=request&applicant=resident"],["Заказать анализ воды","/login?service=lab&applicant=resident"],["Опасный люк","#hazard"]]) { const li=el("li");li.append(link(label,href));quick.append(li);} root.append(quick);

    const outages = section("outages","Отключения по адресу","Укажите улицу и номер дома.");
    const addressForm = el("form"), addressFields = el("div","pub-fields two"), addressQuery = field(addressFields,"Улица, дом или часть адреса","public-address"); addressQuery.maxLength=100;
    const findAddress=button("Найти адрес",()=>addresses.load(false),true); addressForm.append(addressFields,findAddress); addressForm.addEventListener("submit",event=>{event.preventDefault();addresses.load(false);}); outages.append(addressForm);
    let selectedAddress = ""; const addressHost = el("div","pub-addresses"), selected = el("p","pub-selected"); outages.append(addressHost,selected);
    const addresses = pager(addressHost,DISPATCH,"addresses",raw=>({address:text(raw.address,250),updatedAt:date(raw.updatedAt)}),item=>{const li=el("li"); const select=button(item.address,()=>{selectedAddress=item.address;selected.textContent="Выбран адрес: "+item.address;detail.replaceChildren();outageList.load(false);});li.append(select,el("p","pub-meta","Справочник обновлён: "+stamp(item.updatedAt)));return li;},()=>({q:addressQuery.value.trim()}),"Адрес не найден в опубликованном справочнике. Проверьте написание или обратитесь к оператору.");
    filterEdits([addressQuery],()=>addresses.clear());
    const outFilters=el("div","pub-fields"), outState=field(outFilters,"Состояние","public-outage-state","select",[["active","Действующие"],["planned","Плановые"],["archived","Восстановленные / архив"]]), outDates=dates(outFilters,"public-outages"); outages.append(outFilters,el("p","pub-meta","Период начала отключения, до 366 суток. Плановые и восстановленные записи показаны отдельно от действующих."));
    const outActions=el("div","pub-actions");outActions.append(button("Показать отключения",()=>{detail.replaceChildren();outageList.load(false);},true),button("Все адреса",()=>{selectedAddress="";selected.textContent="Все опубликованные адреса";detail.replaceChildren();outageList.load(false);}));outages.append(outActions);
    const outColumns=el("div","pub-columns"), outListHost=el("div"), detail=el("section","pub-detail");detail.setAttribute("aria-label","Карточка отключения");outColumns.append(outListHost,detail);outages.append(outColumns);
    function showOutage(item) { detail.replaceChildren(el("h3","",TYPES[item.type]));definition(detail,[["Состояние",STATES[item.state]],["Причина",item.reason],["Начало",stamp(item.startedAt)],["Прогноз восстановления",stamp(item.expectedRestoredAt)],["Фактическое восстановление",stamp(item.restoredAt)],["Обновлено",stamp(item.updatedAt)]]);detail.append(el("h3","","Затронутые адреса"));const addresses=el("ul");item.addresses.forEach(v=>addresses.append(el("li","",v)));detail.append(addresses,el("h3","","Точки подвоза воды"));
      if (!item.waterPoints.length) detail.append(el("p","","Опубликованных точек подвоза нет.")); else for(const p of item.waterPoints){const row=el("div","pub-record");row.append(el("h3","",p.address));definition(row,[["С",stamp(p.from)],["До",stamp(p.to)],["Пояснение",p.note || "Нет"]]);detail.append(row);}detail.tabIndex=-1;detail.focus(); }
    const outageList=pager(outListHost,DISPATCH,"outages",outage,item=>{const row=el("li","pub-record");row.append(button(TYPES[item.type]+" · "+STATES[item.state],()=>showOutage(item)),el("p","",item.reason),el("p","pub-meta","Начало: "+stamp(item.startedAt)+". Обновлено: "+stamp(item.updatedAt)));return row;},()=>({...period(outDates.from,outDates.to),status:outState.value,...(selectedAddress?{address:selectedAddress}:{})}),"В выбранном периоде опубликованных отключений этого типа не найдено. Это не подтверждение бесперебойной подачи воды.");
    filterEdits([outDates.from,outDates.to],()=>{detail.replaceChildren();outageList.clear();});
    let previousOutState=outState.value;
    filterEdits([outState],()=>{detail.replaceChildren();outageList.clear();if(outState.value===previousOutState)return;previousOutState=outState.value;if(outState.value==="planned"){outDates.from.value=new Date().toISOString().slice(0,10);outDates.to.value=new Date(Date.now()+29*DAY).toISOString().slice(0,10);}else{outDates.from.value=new Date(Date.now()-29*DAY).toISOString().slice(0,10);outDates.to.value=new Date().toISOString().slice(0,10);}});

    const services=section("services","Каталог услуг","Выберите услугу и ознакомьтесь с условиями.");
    const serviceForm=el("form"), serviceFields=el("div","pub-fields two"), serviceQuery=field(serviceFields,"Найти услугу","public-service-search"), applicant=field(serviceFields,"Кто обращается","public-applicant","select",[["resident","Житель / заявитель"],["organization","Представитель организации"]]);serviceQuery.maxLength=100;serviceForm.append(serviceFields,button("Показать услуги",()=>serviceList.load(false),true));serviceForm.addEventListener("submit",e=>{e.preventDefault();serviceList.load(false);});services.append(serviceForm);
    const serviceHost=el("div"), wizard=el("section","pub-wizard");wizard.hidden=true;wizard.setAttribute("aria-label","Начало услуги");services.append(serviceHost,wizard);
    function startWizard(item) { wizard.hidden=false;wizard.replaceChildren(el("h3","","Шаг 1 из 2. Проверьте условия"));wizard.append(el("p","",item.title),el("p","pub-meta","Редакция "+item.version+" от "+stamp(item.publishedAt)),el("p","pub-prose",item.body));const d=item.details;
      definition(wizard,[["Заявитель",applicant.value==="resident"?"Житель / заявитель":"Представитель организации"],["Ориентировочная цена",d.price+" ₽ / "+d.priceUnit],["Исполнение",d.execution==="portal"?"В кабинете":"Работы с последующей отметкой в кабинете"]]);wizard.append(el("h3","","Что подготовить"));if(!d.documents.length)wizard.append(el("p","","Документы на этом шаге не требуются."));else{const ul=el("ul");d.documents.forEach(v=>ul.append(el("li","",v)));wizard.append(ul);}wizard.append(el("p","pub-warning","Этот шаг ещё не создаёт заявку."));
      const actions=el("div","pub-actions");actions.append(button("Продолжить",()=>reviewWizard(item),true),button("Закрыть",()=>{wizard.hidden=true;wizard.replaceChildren();}));wizard.append(actions);wizard.tabIndex=-1;wizard.focus(); }
    function reviewWizard(item) { const d=item.details;wizard.replaceChildren(el("h3","","Шаг 2 из 2. Перейдите к форме"),el("p","",item.title));wizard.append(el("p","","В следующей форме вы заполните сведения и отдельно подтвердите отправку. Заявка здесь не создана."));
      const destination=d.flow==="hazard"?"#hazard":"/login?"+new URLSearchParams({service:d.flow,applicant:applicant.value});const go=link(d.flow==="hazard"?"Открыть гостевую форму":"Открыть форму в кабинете",destination);go.className="pub-continue";wizard.append(go);if(d.flow!=="hazard")wizard.append(el("p","pub-meta","Если у вас нет учётной записи, зарегистрируйтесь. Выбор услуги сохранён только в адресе перехода."),link("Зарегистрироваться и продолжить","/login?"+new URLSearchParams({auth:"register",service:d.flow,applicant:applicant.value})));wizard.append(button("Назад к условиям",()=>startWizard(item))); }
    const serviceList=pager(serviceHost,PUBLIC,"services",entry,item=>{if(item.kind!=="service"||item.state!=="Published"||!item.details.applicants.includes(applicant.value))throw fault();const row=el("li","pub-record");row.append(el("h3","",item.title),el("p","pub-prose",item.body),el("p","",item.details.price+" ₽ / "+item.details.priceUnit+" · ориентировочная цена"),button("Начать: "+item.title,()=>startWizard(item)),el("p","pub-meta","Редакция "+item.version+". Опубликовано: "+stamp(item.publishedAt)));return row;},()=>({q:serviceQuery.value.trim(),applicant:applicant.value}),"В этой категории услуги пока не опубликованы.");
    filterEdits([serviceQuery,applicant],()=>{wizard.hidden=true;wizard.replaceChildren();serviceList.clear();});

    const quality=section("quality","Открытая сводка качества","Выберите озеро и период исследования.");
    const qualityForm=el("form"), qualityFields=el("div","pub-fields"), lake=field(qualityFields,"Территория исследования","public-quality-lake","select",Object.entries(LAKES)), qualityDates=dates(qualityFields,"public-quality");qualityForm.append(qualityFields);const qualityLoad=button("Сформировать сводку",loadQuality,true);qualityForm.append(qualityLoad);qualityForm.addEventListener("submit",e=>{e.preventDefault();loadQuality();});quality.append(qualityForm);const qualityStatus=status(quality), qualityResult=el("div");quality.append(qualityResult);let qualityEpoch=0,qualityController;
    async function loadQuality() { const epoch=++qualityEpoch;qualityController?.abort();qualityController=new AbortController();qualityResult.replaceChildren();qualityLoad.disabled=true;setStatus(qualityStatus,"Загружаем утверждённые значения…");
      try{const p=period(qualityDates.from,qualityDates.to), code=lake.value; if(!Object.hasOwn(LAKES,code))throw fault();const q=new URLSearchParams({...p,lakeCode:code});const raw=obj(await request(LAB,"summary?"+q,{signal:qualityController.signal}));if(epoch!==qualityEpoch)return;
        if(raw.lakeCode!==code||raw.status!=="Approved"||raw.timeBasis!=="collectedAt"||labDate(raw.from)!==p.from||labDate(raw.to)!==p.to)throw fault();const count=integer(raw.sampleCount,0,1000), indicators=list(raw.indicators,4);text(raw.source,200);text(raw.dictionaryVersion,100);const generatedAt=labDate(raw.generatedAt);text(raw.warning,1000);
        if((count===0)!==(indicators.length===0))throw fault();const rows=[];for(const item of indicators){if(!Object.hasOwn(INDICATORS,item.indicatorCode))throw fault();integer(item.count,1,count);text(item.unit,32);text(item.method,100);let values;
          if(item.kind==="decimal"){const numeric=v=>{if(!/^-?(0|[1-9]\d{0,14})(\.\d{1,6})?$/.test(text(v,40)))throw fault();return v;};values=numeric(item.min)+" — "+numeric(item.max);}
          else if(item.kind==="qualitative"){obj(item.counts);integer(item.counts.clear,0,item.count);integer(item.counts.turbid,0,item.count);if(item.counts.clear+item.counts.turbid!==item.count)throw fault();values="Прозрачная: "+item.counts.clear+"; мутная: "+item.counts.turbid;}else throw fault();rows.push([INDICATORS[item.indicatorCode],values,item.unit==="C"?"°C":item.unit==="code"?"Качественное значение":item.unit,String(item.count)]);}
        qualityResult.append(el("h3","",LAKES[code]));definition(qualityResult,[["Утверждённых проб",String(count)],["Источник",raw.source],["Версия справочника",raw.dictionaryVersion],["Сформировано",stamp(generatedAt)]]);
        if(rows.length){const wrap=el("div","pub-table-wrap"),table=el("table","pub-table"),head=el("thead"),tr=el("tr"),body=el("tbody");table.append(el("caption","","Диапазон опубликованных значений за выбранный период"));for(const label of["Показатель","Значения","Единица","Измерений"]){const th=el("th","",label);th.scope="col";tr.append(th);}head.append(tr);for(const values of rows){const r=el("tr");values.forEach(v=>r.append(el("td","",v)));body.append(r);}table.append(head,body);wrap.append(table);qualityResult.append(wrap);}
        qualityResult.append(link("Открыть протоколы и их редакции","lakes.html?"+q));setStatus(qualityStatus,count?"Сводка сформирована.":"В выбранном периоде утверждённых публичных результатов нет. Отсутствие данных не означает нормальное качество воды.");
      }catch(error){if(epoch!==qualityEpoch)return;setStatus(qualityStatus,error.code==="некорректно_период"?"Укажите период от 1 до 366 суток, начиная с 2000 года.":errorLabel(error),true);}finally{if(epoch===qualityEpoch)qualityLoad.disabled=false;}}
    filterEdits([lake,qualityDates.from,qualityDates.to],()=>{qualityEpoch++;qualityController?.abort();qualityLoad.disabled=false;qualityResult.replaceChildren();setStatus(qualityStatus,"Параметры изменены. Сформируйте новую сводку.");});

    const archive=section("archive","Объявления и документы","Публикации и архив.");
    const archiveForm=el("form"), archiveFields=el("div","pub-fields"), archiveKind=field(archiveFields,"Раздел","public-content-kind","select",[["","Все разделы"],...["announcement","tariff","rules","faq"].map(v=>[v,KINDS[v]])]), archiveDates=dates(archiveFields,"public-content",365), archiveSearchFields=el("div","pub-fields two"), archiveQuery=field(archiveSearchFields,"Слова в заголовке или тексте","public-content-search");archiveQuery.maxLength=100;archiveForm.append(archiveFields,archiveSearchFields,button("Показать публикации",()=>contentList.load(false),true));archiveForm.addEventListener("submit",e=>{e.preventDefault();contentList.load(false);});archive.append(archiveForm);const archiveHost=el("div");archive.append(archiveHost);
    const contentList=pager(archiveHost,PUBLIC,"content",entry,item=>{const row=el("li","pub-record"),details=el("details"),summary=el("summary","",item.title);details.append(summary,el("p","pub-prose",item.body));if(item.kind==="tariff")details.append(el("p","",item.details.amount+" ₽ / "+item.details.unit+"."));details.append(el("p","pub-meta","Действует с "+stamp(item.validFrom)+(item.validTo?" до "+stamp(item.validTo):"; окончание не задано")));row.append(el("p","pub-meta",KINDS[item.kind]+" · редакция "+item.version+" · "+(item.state==="Archived"?"В архиве":"Опубликовано")+" · "+stamp(item.publishedAt)),details);return row;},()=>({...period(archiveDates.from,archiveDates.to),kind:archiveKind.value,q:archiveQuery.value.trim()}),"За выбранный период опубликованных материалов не найдено.");
    filterEdits([archiveKind,archiveQuery,archiveDates.from,archiveDates.to],()=>contentList.clear());
    const hazard=section("hazard","Сообщить об опасном люке","Выберите приёмную, укажите адрес и опишите проблему.");
    const hazardHost=el("div");hazard.append(hazardHost);if(globalThis.PortalDispatchUI?.mountPublic){globalThis.PortalDispatchUI.mountPublic({root:hazardHost,request:(path,options)=>request(DISPATCH,path,options)});}else{hazardHost.append(el("p","pub-status","Гостевая форма не подключена к этой сборке."),link("Обратиться через личный кабинет","/login?service=request&applicant=resident"));}
    const contacts=section("contacts","Контакты службы","Отправьте обращение через личный кабинет и отслеживайте ответ.");contacts.append(link("Написать службе в кабинете","/login?service=request&applicant=resident"));
    loadSummary();outageList.load();serviceList.load();contentList.load();
    return {refresh(){loadSummary();outageList.load();serviceList.load();contentList.load();},destroy(){addresses.clear();outageList.clear();serviceList.clear();contentList.clear();qualityEpoch++;qualityController?.abort();root.replaceChildren();}};
  }
  globalThis.PublicPortal = Object.freeze({mount});
  const root = document.getElementById("public-portal"); if(root) mount({root});
})();
