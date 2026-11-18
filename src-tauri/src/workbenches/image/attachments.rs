//! 图片附件 SQL：request_attachments 元数据读写。

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::util::now_rfc3339;

/// 插入附件元数据。文件本体已在 archives/ 下。
pub fn insert(
    conn: &Connection,
    trace_id: &str,
    kind: &str,
    file_path: &str,
    mime_type: Option<&str>,
    size_bytes: Option<i64>,
    checksum: Option<&str>,
) -> AppResult<String> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO request_attachments \
         (id, trace_id, kind, file_path, mime_type, size_bytes, checksum, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            trace_id,
            kind,
            file_path,
            mime_type,
            size_bytes,
            checksum,
            now_rfc3339()
        ],
    )?;
    Ok(id)
}

/// 读取归档图片为 base64（供前端展示）。
pub fn read_image_base64(data_dir: &std::path::Path, rel_path: &str) -> AppResult<String> {
    if rel_path.contains("..") {
        return Err(AppError::Invalid("非法的归档路径".into()));
    }
    let bytes = std::fs::read(data_dir.join(rel_path))
        .map_err(|e| AppError::Invalid(format!("读取图片归档失败: {e}")))?;
    Ok(base64_encode(&bytes))
}

/// 标准 base64（无依赖实现）。
pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }
}
