fn main() {
    println!("cargo:rustc-link-lib=xslt");
    cc::Build::new().file("src/quiet_xml.c").compile("quiet_xml");
}
