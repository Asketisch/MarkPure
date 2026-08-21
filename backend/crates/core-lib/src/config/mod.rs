//! 应用配置：跨启动保留的每用户设置。以 TOML 形式存放在
//! [`AppConfig::config_path`] 返回的 OS 适当地路径上。
//!
//! 原来 530 行的单体文件在 `config.rs`。现已拆分为：
//!
//! - [`legacy`] —— `AppConfig` 结构体本身，加上加载/保存/迁移机制
//!   以及逐字段 CRUD（最近文件、语言、主题、编辑器偏好）。
//! - [`workspace_roots`] —— 多根目录工作区辅助
//!   （`add_workspace_root`、`remove_workspace_root`、
//!   `set_active_workspace_root`、按根目录展开的目录记忆）。
//!
//! 两个文件都声明 `impl AppConfig` 块，公共 API 保持不变——调用方
//! 看到的方法集相同，拆分纯粹是实现细节。

mod legacy;
mod workspace_roots;

// `legacy.rs` 已声明 `pub struct AppConfig` 及其固有方法；我们在这里
// 再导出该类型，让公共路径保持 `mt_core::AppConfig`。`workspace_roots`
// 模块通过自己的 `impl AppConfig` 块添加更多固有方法。
pub use legacy::AppConfig;