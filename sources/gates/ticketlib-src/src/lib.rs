#![allow(clippy::missing_safety_doc)]

use samael::crypto::{CertificateDer, CryptoProvider, Crypto};
use samael::schema::Assertion;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::sync::Once;

type XmlGenericErrorFunc = *const c_void;

extern "C" {
    fn xmlSetGenericErrorFunc(ctx: *mut c_void, handler: XmlGenericErrorFunc);
    fn quiet_xml_noop();
}

static INIT_QUIET: Once = Once::new();

fn suppress_xml_errors() {
    INIT_QUIET.call_once(|| unsafe {
        xmlSetGenericErrorFunc(std::ptr::null_mut(), quiet_xml_noop as XmlGenericErrorFunc);
    });
}

const ISSUER: &str = "omsk-komendant";
const AUDIENCE: &str = "omsk-gate";

pub const LEVEL_REJECT: i32 = -1;
pub const LEVEL_GUEST: i32 = 0;
pub const LEVEL_RESIDENT: i32 = 1;
pub const LEVEL_COMMANDANT: i32 = 9;

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn assertion_xml_template(subject: &str, role: &str, pass_id: &str) -> String {
    let subj_escaped = xml_escape(subject);
    let mut s = String::with_capacity(2048);
    s.push_str("<saml:Assertion xmlns:saml=\"urn:oasis:names:tc:SAML:2.0:assertion\"");
    s.push_str(" xmlns:pass=\"urn:omsk:gate:v2:meta\" pass:v=\"2\"");
    s.push_str(" ID=\"");
    s.push_str(pass_id);
    s.push_str("\" Version=\"2.0\" IssueInstant=\"2026-10-07T00:00:00Z\">");
    s.push_str("<saml:Issuer>");
    s.push_str(ISSUER);
    s.push_str("</saml:Issuer>");
    s.push_str("<ds:Signature xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\">");
    s.push_str("<ds:SignedInfo>");
    s.push_str("<ds:CanonicalizationMethod Algorithm=\"http://www.w3.org/2001/10/xml-exc-c14n#\"/>");
    s.push_str("<ds:SignatureMethod Algorithm=\"http://www.w3.org/2001/04/xmldsig-more#rsa-sha256\"/>");
    s.push_str("<ds:Reference URI=\"#");
    s.push_str(pass_id);
    s.push_str("\">");
    s.push_str("<ds:Transforms>");
    s.push_str("<ds:Transform Algorithm=\"http://www.w3.org/2000/09/xmldsig#enveloped-signature\"/>");
    s.push_str("<ds:Transform Algorithm=\"http://www.w3.org/2001/10/xml-exc-c14n#\"/>");
    s.push_str("</ds:Transforms>");
    s.push_str("<ds:DigestMethod Algorithm=\"http://www.w3.org/2001/04/xmlenc#sha256\"/>");
    s.push_str("<ds:DigestValue></ds:DigestValue>");
    s.push_str("</ds:Reference>");
    s.push_str("</ds:SignedInfo>");
    s.push_str("<ds:SignatureValue></ds:SignatureValue>");
    s.push_str("</ds:Signature>");
    s.push_str("<saml:Conditions NotBefore=\"2020-01-01T00:00:00Z\" NotOnOrAfter=\"2030-01-01T00:00:00Z\">");
    s.push_str("<saml:AudienceRestriction><saml:Audience>");
    s.push_str(AUDIENCE);
    s.push_str("</saml:Audience></saml:AudienceRestriction>");
    s.push_str("</saml:Conditions>");
    s.push_str("<saml:Subject><saml:NameID>");
    s.push_str(&subj_escaped);
    s.push_str("</saml:NameID></saml:Subject>");
    s.push_str("<saml:AttributeStatement pass:sealed=\"true\">");
    s.push_str("<saml:Attribute Name=\"role\">");
    s.push_str("<saml:AttributeValue>");
    s.push_str(role);
    s.push_str("</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>");
    s.push_str("</saml:Assertion>");
    s
}

pub fn issue(subject: &str, role: &str, private_key_der: &[u8]) -> Option<String> {
    let pass_id = format!("_pass_{:x}", {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        subject.hash(&mut h);
        role.hash(&mut h);
        h.finish()
    });
    let template = assertion_xml_template(subject, role, &pass_id);
    Crypto::sign_xml(template.as_bytes(), private_key_der).ok()
}

fn cert(certificate_der: &[u8]) -> CertificateDer {
    CertificateDer::from(certificate_der.to_vec())
}

pub fn verify_signature(xml: &[u8], certificate_der: &[u8]) -> bool {
    suppress_xml_errors();
    Crypto::verify_signed_xml(xml, &cert(certificate_der), Some("ID")).is_ok()
}

fn parse_assertion(xml: &str) -> Option<Assertion> {
    xml.parse::<Assertion>().ok()
}

fn check_issuer_val(a: &Assertion) -> bool {
    a.issuer.value.as_deref() == Some(ISSUER)
}

fn check_audience_val(a: &Assertion) -> bool {
    if let Some(ref cond) = a.conditions {
        if let Some(ref restrictions) = cond.audience_restrictions {
            for ar in restrictions {
                for aud in &ar.audience {
                    if aud == AUDIENCE {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn check_timebounds_val(a: &Assertion) -> bool {
    if let Some(ref cond) = a.conditions {
        let now = chrono::Utc::now();
        if let Some(nb) = cond.not_before {
            if now < nb {
                return false;
            }
        }
        if let Some(na) = cond.not_on_or_after {
            if now >= na {
                return false;
            }
        }
        return true;
    }
    false
}

fn count_assertions(xml: &str) -> usize {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_str(xml);
    let mut count = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                if e.local_name().as_ref() == b"Assertion" {
                    count += 1;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    count
}

fn get_role_from_assertion(a: &Assertion) -> Option<String> {
    if let Some(ref stmts) = a.attribute_statements {
        for stmt in stmts {
            for attr in &stmt.attributes {
                if attr.name.as_deref() == Some("role") {
                    if let Some(first) = attr.values.first() {
                        return first.value.clone();
                    }
                }
            }
        }
    }
    None
}

fn role_to_level(role: &str) -> i32 {
    match role {
        "commandant" => LEVEL_COMMANDANT,
        "resident" => LEVEL_RESIDENT,
        "guest" => LEVEL_GUEST,
        _ => LEVEL_GUEST,
    }
}

fn extract_reference_id(xml: &str) -> Option<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    let mut sig_depth: u32 = 0;
    let mut in_signed_info = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                match e.local_name().as_ref() {
                    b"Signature" => sig_depth += 1,
                    b"SignedInfo" if sig_depth > 0 => in_signed_info = true,
                    b"Reference" if in_signed_info => {
                        for a in e.attributes().flatten() {
                            if a.key.local_name().as_ref() == b"URI" {
                                let val = std::str::from_utf8(a.value.as_ref()).ok()?;
                                return val.strip_prefix('#').map(|s| s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                if sig_depth > 0 && in_signed_info && e.local_name().as_ref() == b"Reference" {
                    for a in e.attributes().flatten() {
                        if a.key.local_name().as_ref() == b"URI" {
                            let val = std::str::from_utf8(a.value.as_ref()).ok()?;
                            return val.strip_prefix('#').map(|s| s.to_string());
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                match e.local_name().as_ref() {
                    b"Signature" if sig_depth > 0 => sig_depth -= 1,
                    b"SignedInfo" => in_signed_info = false,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    None
}

pub fn verify(xml: &[u8], certificate_der: &[u8]) -> i32 {
    suppress_xml_errors();
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return LEVEL_REJECT,
    };
    let assertion = match parse_assertion(xml_str) {
        Some(a) => a,
        None => return LEVEL_REJECT,
    };
    if count_assertions(xml_str) != 1 {
        return LEVEL_REJECT;
    }
    if !verify_signature(xml, certificate_der) {
        return LEVEL_REJECT;
    }
    if !check_issuer_val(&assertion) {
        return LEVEL_REJECT;
    }
    if !check_timebounds_val(&assertion) {
        return LEVEL_REJECT;
    }
    if !check_audience_val(&assertion) {
        return LEVEL_REJECT;
    }
    match extract_reference_id(xml_str) {
        Some(ref rid) if assertion.id == *rid => {}
        _ => return LEVEL_REJECT,
    }
    match get_role_from_assertion(&assertion) {
        Some(r) => role_to_level(&r),
        None => LEVEL_GUEST,
    }
}

// ---- C ABI ----

fn to_c(s: String) -> *mut c_char {
    CString::new(s).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "C" fn tl_version() -> *mut c_char {
    to_c("ticketlib/0.9.0 (SAML2, RSA-SHA256, exc-c14n, samael+xmlsec1)".into())
}

#[no_mangle]
pub unsafe extern "C" fn tl_issue_pass(
    subject: *const c_char,
    role: *const c_char,
    key_ptr: *const c_char,
    key_len: usize,
) -> *mut c_char {
    if subject.is_null() || role.is_null() || key_ptr.is_null() {
        return std::ptr::null_mut();
    }
    let s = CStr::from_ptr(subject).to_string_lossy().into_owned();
    let r = CStr::from_ptr(role).to_string_lossy().into_owned();
    let key = std::slice::from_raw_parts(key_ptr as *const u8, key_len);
    match issue(&s, &r, key) {
        Some(x) => to_c(x),
        None => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn tl_verify_pass(
    ptr: *const c_char,
    len: usize,
    cert_ptr: *const c_char,
    cert_len: usize,
) -> c_int {
    if ptr.is_null() || cert_ptr.is_null() {
        return LEVEL_REJECT;
    }
    let xml = std::slice::from_raw_parts(ptr as *const u8, len);
    let certificate = std::slice::from_raw_parts(cert_ptr as *const u8, cert_len);
    verify(xml, certificate)
}

#[no_mangle]
pub unsafe extern "C" fn tl_pass_grants_flag(
    ptr: *const c_char,
    len: usize,
    cert_ptr: *const c_char,
    cert_len: usize,
) -> c_int {
    (tl_verify_pass(ptr, len, cert_ptr, cert_len) >= LEVEL_COMMANDANT) as c_int
}

#[no_mangle]
pub unsafe extern "C" fn tl_verify_signature(
    ptr: *const c_char,
    len: usize,
    cert_ptr: *const c_char,
    cert_len: usize,
) -> c_int {
    if ptr.is_null() || cert_ptr.is_null() {
        return 0;
    }
    let xml = std::slice::from_raw_parts(ptr as *const u8, len);
    let certificate = std::slice::from_raw_parts(cert_ptr as *const u8, cert_len);
    verify_signature(xml, certificate) as c_int
}

#[no_mangle]
pub unsafe extern "C" fn tl_check_issuer(ptr: *const c_char, len: usize) -> c_int {
    if ptr.is_null() {
        return 0;
    }
    let xml = std::slice::from_raw_parts(ptr as *const u8, len);
    let s = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    parse_assertion(s).map(|a| check_issuer_val(&a) as c_int).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn tl_check_audience(ptr: *const c_char, len: usize) -> c_int {
    if ptr.is_null() {
        return 0;
    }
    let xml = std::slice::from_raw_parts(ptr as *const u8, len);
    let s = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    parse_assertion(s).map(|a| check_audience_val(&a) as c_int).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn tl_check_timebounds(ptr: *const c_char, len: usize) -> c_int {
    if ptr.is_null() {
        return 0;
    }
    let xml = std::slice::from_raw_parts(ptr as *const u8, len);
    let s = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    parse_assertion(s).map(|a| check_timebounds_val(&a) as c_int).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn tl_extract_attribute(
    ptr: *const c_char, len: usize, name: *const c_char,
) -> *mut c_char {
    if ptr.is_null() || name.is_null() {
        return std::ptr::null_mut();
    }
    let xml = std::slice::from_raw_parts(ptr as *const u8, len);
    let s = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let nm = CStr::from_ptr(name).to_string_lossy().into_owned();
    let a = match parse_assertion(s) {
        Some(a) => a,
        None => return std::ptr::null_mut(),
    };
    if let Some(ref stmts) = a.attribute_statements {
        for stmt in stmts {
            for attr in &stmt.attributes {
                if attr.name.as_deref() == Some(nm.as_str()) {
                    if let Some(first) = attr.values.first() {
                        if let Some(ref v) = first.value {
                            return to_c(v.clone());
                        }
                    }
                }
            }
        }
    }
    std::ptr::null_mut()
}

#[no_mangle]
pub unsafe extern "C" fn tl_free(p: *mut c_char) {
    if !p.is_null() {
        drop(CString::from_raw(p));
    }
}

// ---- PyO3 bindings ----

#[cfg(feature = "python")]
use pyo3::prelude::*;

#[cfg(feature = "python")]
#[pyfunction]
fn issue_pass(subject: &str, role: &str, private_key_der: &[u8]) -> Option<String> {
    issue(subject, role, private_key_der)
}

#[cfg(feature = "python")]
#[pyfunction]
fn verify_pass(xml: &str, certificate_der: &[u8]) -> i32 {
    verify(xml.as_bytes(), certificate_der)
}

#[cfg(feature = "python")]
#[pyfunction]
fn pass_grants_flag(xml: &str, certificate_der: &[u8]) -> bool {
    verify(xml.as_bytes(), certificate_der) >= LEVEL_COMMANDANT
}

#[cfg(feature = "python")]
#[pyfunction]
fn version() -> &'static str {
    "ticketlib/0.9.0 (SAML2, RSA-SHA256, exc-c14n)"
}

#[cfg(feature = "python")]
#[pymodule]
fn ticketlib(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(issue_pass, m)?)?;
    m.add_function(wrap_pyfunction!(verify_pass, m)?)?;
    m.add_function(wrap_pyfunction!(pass_grants_flag, m)?)?;
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add("LEVEL_REJECT", LEVEL_REJECT)?;
    m.add("LEVEL_GUEST", LEVEL_GUEST)?;
    m.add("LEVEL_RESIDENT", LEVEL_RESIDENT)?;
    m.add("LEVEL_COMMANDANT", LEVEL_COMMANDANT)?;
    Ok(())
}
