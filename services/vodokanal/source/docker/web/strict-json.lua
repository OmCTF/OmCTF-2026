local M = {}
local NULL = {}
local function utf8char(n)
    if n < 128 then return string.char(n) end
    if n < 2048 then return string.char(192 + math.floor(n / 64), 128 + n % 64) end
    if n < 65536 then return string.char(224 + math.floor(n / 4096), 128 + math.floor(n / 64) % 64, 128 + n % 64) end
    return string.char(240 + math.floor(n / 262144), 128 + math.floor(n / 4096) % 64, 128 + math.floor(n / 64) % 64, 128 + n % 64)
end
function M.decode(input)
    if type(input) ~= 'string' or #input > 8192 then return nil end
    local s, p, nodes = input, 1, 0
    if s:sub(1, 3) == '\239\187\191' then p = 4 end
    local function fail() error('invalid_json', 0) end
    local function byte() return s:byte(p) end
    local function ws()
        while byte() == 32 or byte() == 9 or byte() == 10 or byte() == 13 do p = p + 1 end
    end
    local function hex4()
        local v = 0
        for _ = 1, 4 do
            local c = byte(); local n
            if c and c >= 48 and c <= 57 then n = c - 48
            elseif c and c >= 65 and c <= 70 then n = c - 55
            elseif c and c >= 97 and c <= 102 then n = c - 87
            else fail() end
            v = v * 16 + n; p = p + 1
        end
        return v
    end
    local function str()
        if byte() ~= 34 then fail() end
        p = p + 1; local out = {}
        while true do
            local c = byte()
            if not c or c < 32 then fail() end
            if c == 34 then p = p + 1; return table.concat(out) end
            if c == 92 then
                p = p + 1; local e = byte(); p = p + 1
                local escapes = {[34]='"',[92]='\\',[47]='/',[98]='\b',[102]='\f',[110]='\n',[114]='\r',[116]='\t'}
                if escapes[e] then out[#out + 1] = escapes[e]
                elseif e == 117 then
                    local n = hex4()
                    if n >= 55296 and n <= 56319 then
                        if s:sub(p, p + 1) ~= '\\u' then fail() end
                        p = p + 2; local low = hex4()
                        if low < 56320 or low > 57343 then fail() end
                        n = 65536 + (n - 55296) * 1024 + low - 56320
                    elseif n >= 56320 and n <= 57343 then fail() end
                    out[#out + 1] = utf8char(n)
                else fail() end
            elseif c < 128 then out[#out + 1] = string.char(c); p = p + 1
            else
                local width, min, n
                if c >= 194 and c <= 223 then width, min, n = 2, 128, c - 192
                elseif c >= 224 and c <= 239 then width, min, n = 3, 2048, c - 224
                elseif c >= 240 and c <= 244 then width, min, n = 4, 65536, c - 240
                else fail() end
                for i = 1, width - 1 do
                    local nextbyte = s:byte(p + i)
                    if not nextbyte or nextbyte < 128 or nextbyte > 191 then fail() end
                    n = n * 64 + nextbyte - 128
                end
                if n < min or n > 1114111 or (n >= 55296 and n <= 57343) then fail() end
                out[#out + 1] = s:sub(p, p + width - 1); p = p + width
            end
        end
    end
    local function digit(c) return c and c >= 48 and c <= 57 end
    local function number()
        local start = p
        if byte() == 45 then p = p + 1 end
        if byte() == 48 then p = p + 1
        elseif byte() and byte() >= 49 and byte() <= 57 then repeat p = p + 1 until not digit(byte())
        else fail() end
        if byte() == 46 then p = p + 1; if not digit(byte()) then fail() end; repeat p = p + 1 until not digit(byte()) end
        if byte() == 101 or byte() == 69 then
            p = p + 1; if byte() == 43 or byte() == 45 then p = p + 1 end
            if not digit(byte()) then fail() end; repeat p = p + 1 until not digit(byte())
        end
        local n = tonumber(s:sub(start, p - 1))
        if not n or n == math.huge or n == -math.huge or n ~= n then fail() end
        return n
    end
    local value
    value = function(depth)
        nodes = nodes + 1; if depth > 8 or nodes > 128 then fail() end
        ws(); local c = byte()
        if c == 34 then return str() end
        if c == 123 then
            p = p + 1; ws(); local o = {}
            if byte() == 125 then p = p + 1; return o end
            while true do
                ws(); local k = str(); if o[k] ~= nil then fail() end
                ws(); if byte() ~= 58 then fail() end; p = p + 1
                o[k] = value(depth + 1); ws()
                if byte() == 125 then p = p + 1; return o end
                if byte() ~= 44 then fail() end; p = p + 1
            end
        end
        if c == 91 then
            p = p + 1; ws(); local a = {}
            if byte() == 93 then p = p + 1; return a end
            while true do
                a[#a + 1] = value(depth + 1); ws()
                if byte() == 93 then p = p + 1; return a end
                if byte() ~= 44 then fail() end; p = p + 1
            end
        end
        for literal, result in pairs({['true']=true,['false']=false,['null']=NULL}) do
            if s:sub(p, p + #literal - 1) == literal then p = p + #literal; return result end
        end
        return number()
    end
    local ok, result = pcall(function() local v = value(0); ws(); if p ~= #s + 1 then fail() end; return v end)
    if ok then return result end
    return nil
end
return M
