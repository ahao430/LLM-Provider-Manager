//! 统一错误类型。序列化为字符串传给前端，不泄漏凭证信息。

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri 错误: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("备份打包错误: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("数据错误: {0}")]
    Invalid(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
