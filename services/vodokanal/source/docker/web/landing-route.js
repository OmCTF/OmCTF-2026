(() => {
  "use strict";
  if (!["/", "/home.html"].includes(location.pathname)) return;
  const params = new URLSearchParams(location.search);
  const oneOf = (key, values) => params.getAll(key).length === 1 && values.includes(params.get(key));
  if (oneOf("auth", ["register", "recovery"]) || oneOf("service", ["meter", "request", "lab", "water"])) {
    location.replace("/login" + location.search + location.hash);
  }
})();
