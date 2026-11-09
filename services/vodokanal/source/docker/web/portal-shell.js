(function () {
  "use strict";
  function mount() {
    const navigation = document.getElementById("service-navigation");
    const application = document.getElementById("application");
    const workspace = document.getElementById("workspace-select");
    const label = document.getElementById("service-workspace-label");
    if (!navigation || !application || !workspace || !label) return;
    const dashboard = document.getElementById("main");
    const title = document.getElementById("cabinet-page-title");
    const breadcrumb = document.getElementById("cabinet-breadcrumb");
    const intro = document.getElementById("cabinet-page-intro");
    const permanent = new Set(["service-entry-notice", "module-lock-notice", "module-availability-note", "host-create-receipt"]);
    const pages = [];
    for (const child of dashboard.children) {
      if (permanent.has(child.id) || child.classList.contains("page-heading")) continue;
      const view = child.id === "cabinet-overview" || child.classList.contains("profile-card") ? "main"
        : child.matches(".workspace-grid,.roles-card,.invitations-card,.sessions-card") ? "workspace-settings" : child.id;
      if (view) { child.dataset.cabinetPage = view; pages.push(child); }
    }
    const links = [...navigation.querySelectorAll('a[href^="#"]')];
    function activateSection(id) {
      if (application.hidden) return false;
      const target = document.getElementById(id);
      if (!target || target.hidden) return false;
      const view = id === "main" ? "main" : target.closest("[data-cabinet-page]")?.dataset.cabinetPage;
      if (!view || !pages.some(page => page.dataset.cabinetPage === view)) return false;
      application.dataset.cabinetView = view;
      for (const page of pages) page.toggleAttribute("data-cabinet-active", page.dataset.cabinetPage === view);
      const link = links.find(item => item.getAttribute("href") === "#" + view);
      for (const item of links) {
        item.classList.toggle("selected", item === link);
        if (item === link) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
      }
      const labelCopy = link?.cloneNode(true); labelCopy?.querySelector(".nav-icon")?.remove();
      const caption = view === "main" ? "Личный кабинет" : labelCopy?.textContent.trim() || target.getAttribute("aria-label") || "Личный кабинет";
      if (title) title.textContent = caption;
      if (breadcrumb) breadcrumb.textContent = view === "main" ? "Обзор" : caption;
      if (intro) intro.hidden = view !== "main";
      if (narrow.matches) navigation.open = false;
      return true;
    }
    function syncViews() {
      if (application.hidden) {
        application.dataset.cabinetView = "main";
        for (const page of pages) page.toggleAttribute("data-cabinet-active", page.dataset.cabinetPage === "main");
      } else {
        const selected = application.dataset.cabinetView || location.hash.slice(1) || "main";
        if (!activateSection(selected)) activateSection("main");
      }
      for (const shortcut of application.querySelectorAll(".cabinet-shortcut")) {
        const target = document.getElementById(shortcut.hash.slice(1));
        const link = links.find(item => item.hash === shortcut.hash);
        shortcut.hidden = !target || target.hidden || !link || link.hidden;
      }
    }
    application.addEventListener("click", event => {
      const shortcut = event.target.closest("[data-cabinet-link]");
      if (!shortcut || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = links.find(item => item.hash === shortcut.hash);
      event.preventDefault();
      if (link && !link.hidden) link.click();
    });
    globalThis.VodokanalShell = Object.freeze({ activateSection, syncViews });
    application.dataset.cabinetReady = "true";
    const narrow = matchMedia("(max-width:760px)");
    function adaptNavigation() {
      if (!narrow.matches) navigation.open = true;
      else {
        const focusInside = navigation.contains(document.activeElement);
        navigation.open = focusInside;
      }
    }
    function syncContext() {
      const selected = workspace.selectedOptions[0];
      label.textContent = application.hidden || !selected?.value ? "Выберите пространство" : selected.textContent;
    }
    adaptNavigation();
    narrow.addEventListener("change", adaptNavigation);
    workspace.addEventListener("change", syncContext);
    new MutationObserver(syncContext).observe(workspace, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["selected"] });
    new MutationObserver(() => {
      syncContext();
      syncViews();
      if (application.hidden && narrow.matches) navigation.open = false;
    }).observe(application, { attributes:true, attributeFilter:["hidden"] });
    const availability = new MutationObserver(syncViews);
    availability.observe(navigation, { subtree:true, attributes:true, attributeFilter:["hidden"] });
    for (const page of pages) availability.observe(page, { attributes:true, attributeFilter:["hidden"] });
    syncContext();
    syncViews();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once:true });
  else mount();
})();
