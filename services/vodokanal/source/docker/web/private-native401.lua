function private_native401(r)
    if r.status ~= 401 or not (r.uri == "/vodokanal/hs/api/v1" or
        r.uri:sub(1, 21) == "/vodokanal/hs/api/v1/") then return end
    if r.headers_out["X-API-Contract"] == "1.0" or
        r.err_headers_out["X-API-Contract"] == "1.0" then return end
    local id = r.subprocess_env["UNIQUE_ID"] or ""
    if not id:match("^[A-Za-z0-9_-]+$") or #id > 128 then
        id = "edge-id-unavailable"
    end
    local safe = '{"error":{"code":"кабинет_аутентификация_требуется",' ..
        '"message":"Войдите в кабинет заново."},"requestId":"' .. id .. '"}'
    for _, name in ipairs({"Content-Length", "Content-Encoding", "Content-MD5",
        "Content-Disposition", "ETag", "Last-Modified", "Content-Type",
        "X-Request-ID", "WWW-Authenticate", "Cache-Control"}) do
        r.headers_out[name] = nil
        r.err_headers_out[name] = nil
    end
    r.content_type = "application/json; charset=utf-8"
    r.headers_out["Content-Length"] = tostring(#safe)
    r.err_headers_out["X-Request-ID"] = id
    r.headers_out["Cache-Control"] = "no-store"
    coroutine.yield(r.method == "HEAD" and "" or safe)
    while bucket ~= nil do coroutine.yield("") end
end
