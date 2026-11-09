local json = require('strict-json')
local function keys(o, names)
    if type(o) ~= 'table' then return false end
    local count = 0; for _ in pairs(o) do count = count + 1 end
    if count ~= #names then return false end
    for _, n in ipairs(names) do if o[n] == nil then return false end end
    return true
end
local function text(s, min, max)
    return type(s) == 'string' and #s >= min and #s <= max and not s:find('\000', 1, true)
end
local function uuid(s)
    return type(s) == 'string' and #s == 36 and s:match('^[0-9a-f]+%-[0-9a-f]+%-[0-9a-f]+%-[0-9a-f]+%-[0-9a-f]+$') and
        s:sub(9,9) == '-' and s:sub(14,14) == '-' and s:sub(19,19) == '-' and s:sub(24,24) == '-'
end
function is_known_native_session(body, expected_reason)
    expected_reason = expected_reason or 404
    if expected_reason ~= 404 and expected_reason ~= -3 then return false end
    local o = json.decode(body)
    if not keys(o, {'#exception','exception'}) or o['#exception'] ~= '{http://v8.1c.ru/8.2/virtual-resource-system}Exception' then return false end
    local e = o.exception
    if not keys(e, {'clsid','reason','descr','creationStack','category','#inner','inner'}) or
        e.clsid ~= '580392e6-ba49-4280-ac67-fcd6f2180121' or e.reason ~= expected_reason or
        e['#inner'] ~= '{http://v8.1c.ru/8.2/managed-application/seancecontextexception}SeanceContextException' or
        not text(e.descr, 1, 1024) or not text(e.creationStack, 0, 4096) or not text(e.category, 1, 128) then return false end
    local i = e.inner
    if not keys(i, {'clsid','reason','descr','creationStack','category','uiHelperUUID'}) or
        i.clsid ~= '60c686dc-798f-4d17-aadb-a90156a16eb8' or i.reason ~= 1 or
        not text(i.descr, 1, 1024) or not text(i.creationStack, 1, 4096) or not text(i.category, 1, 128) or not uuid(i.uiHelperUUID) then return false end
    local prefix
    for _, candidate in ipairs({'Session is not available or has been dropped\nID=', 'Сеанс отсутствует или удален\nID='}) do
        if i.descr:sub(1, #candidate) == candidate then prefix = candidate; break end
    end
    if not prefix then return false end
    local rest = i.descr:sub(#prefix + 1)
    return uuid(rest:sub(1, 36)) and rest:sub(37, 43) == ', File=' and #rest > 43
end
function private_native_session(r)
    if r.method == 'HEAD' or not (r.uri == '/vodokanal/hs/api/v1' or
        r.uri:sub(1, 21) == '/vodokanal/hs/api/v1/') then return end
    local expected_reason = 404
    if r.status == 500 and r.method == 'DELETE' and r.uri == '/vodokanal/hs/api/v1/auth/session' and r.headers_in['IBSession'] == 'finish' then
        expected_reason = -3
    elseif r.status ~= 404 then return end
    if r.headers_out['X-API-Contract'] == '1.0' or r.err_headers_out['X-API-Contract'] == '1.0' then return end
    local ct = (r.content_type or ''):lower()
    if ct ~= 'application/json' and not ct:match('^application/json%s*;') then return end
    if r.headers_out['Content-Encoding'] or r.err_headers_out['Content-Encoding'] then return end
    local pieces, size = {}, 0
    coroutine.yield()
    while bucket ~= nil do
        if size + #bucket > 8192 then
            coroutine.yield(table.concat(pieces) .. bucket)
            while bucket ~= nil do coroutine.yield(bucket) end
            return
        end
        pieces[#pieces + 1] = bucket; size = size + #bucket
        coroutine.yield('')
    end
    local body = table.concat(pieces)
    if not is_known_native_session(body, expected_reason) then coroutine.yield(body); return end
    local id = r.subprocess_env['UNIQUE_ID'] or ''
    if not id:match('^[A-Za-z0-9_-]+$') or #id > 128 then id = 'edge-id-unavailable' end
    local safe = '{"error":{"code":"кабинет_аутентификация_требуется","message":"Войдите в кабинет заново."},"requestId":"' .. id .. '"}'
    for _, name in ipairs({'Content-Length','Content-Encoding','Content-MD5','Content-Disposition','ETag','Last-Modified','Content-Type','X-Request-ID','WWW-Authenticate','Set-Cookie','Cache-Control','X-API-Contract'}) do
        r.headers_out[name] = nil; r.err_headers_out[name] = nil
    end
    r.status = 401
    r.content_type = 'application/json; charset=utf-8'
    r.headers_out['Content-Length'] = tostring(#safe)
    r.err_headers_out['X-Request-ID'] = id
    r.err_headers_out['X-API-Contract'] = '1.0'
    r.headers_out['Cache-Control'] = 'no-store'
    coroutine.yield(safe)
end
