fn main() {
    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=../dist/assets");

    embed_windows_resources();
}

// 仅在 Windows 目标下把图标与版本信息嵌进 exe 资源，
// 让资源管理器显示正确的文件图标和「属性 → 详细信息」中的版本号。
// 注意必须用 #[cfg] 属性做条件编译（winresource 只在 cfg(windows) 下
// 作为 build-dependency 引入）；cfg!() 宏只是布尔值，不做编译剔除。
#[cfg(windows)]
fn embed_windows_resources() {
    // 图标来源：仓库根 resources/icons/markpure.ico
    //（由 scripts/make-ico.py 从 PNG 套图生成，已提交版本库）
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let icon = std::path::Path::new(&manifest_dir)
        .join("../../../resources/icons/markpure.ico");
    if !icon.exists() {
        panic!(
            "Windows 图标缺失：{}（运行 python3 scripts/make-ico.py 生成）",
            icon.display()
        );
    }
    println!("cargo:rerun-if-changed={}", icon.display());

    let mut res = winresource::WindowsResource::new();
    res.set_icon(icon.to_str().unwrap());
    res.set("FileDescription", env!("CARGO_PKG_DESCRIPTION"));
    res.set("ProductName", "MarkPure");
    res.set("ProductVersion", env!("CARGO_PKG_VERSION"));
    res.set("FileVersion", env!("CARGO_PKG_VERSION"));
    res.set("OriginalFilename", "markpure.exe");

    res.compile().expect("嵌入 Windows 资源失败");
}

#[cfg(not(windows))]
fn embed_windows_resources() {}
