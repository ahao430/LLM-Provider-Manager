//! 备份文件加密（.lcmbackup）。
//!
//! 文件格式（PLAN.md「备份与恢复」）：
//! - `LCMB1` 魔数 + 盐1 + nonce1 + 密文长度 + 密文（zip 数据库与文件归档）
//! - 若包含凭证：盐2 + nonce2 + 密文长度 + 密文（凭证 JSON，独立加密段——
//!   凭证绝不以明文进入普通备份文件，PLAN.md 安全约束）
//! - 密钥 = PBKDF2-HMAC-SHA256(密码, 盐, 200_000 轮)，AES-256-GCM 认证加密。

use std::fs;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

use crate::error::{AppError, AppResult};

/// 文件魔数（含格式版本）。
const MAGIC: &[u8; 6] = b"LCMB1\x01";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const PBKDF2_ROUNDS: u32 = 200_000;
/// 密文长度字段（u32 BE）。
const LEN_PREFIX: usize = 4;

fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ROUNDS, &mut key);
    key
}

fn random_bytes(len: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut buf = vec![0u8; len];
    rand::rng().fill_bytes(&mut buf);
    buf
}

fn encrypt_segment(plain: &[u8], password: &str, salt: &[u8]) -> AppResult<(Vec<u8>, Vec<u8>)> {
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new((&key).into());
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plain,
                aad: MAGIC,
            },
        )
        .map_err(|_| AppError::Invalid("加密失败".into()))?;
    Ok((nonce_bytes, ct))
}

fn decrypt_segment(nonce: &[u8], ct: &[u8], password: &str, salt: &[u8]) -> AppResult<Vec<u8>> {
    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new((&key).into());
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ct,
                aad: MAGIC,
            },
        )
        .map_err(|_| AppError::Invalid("解密失败：密码错误或备份文件已损坏".into()))
}

fn push_segment(out: &mut Vec<u8>, salt: &[u8], nonce: &[u8], ct: &[u8]) {
    out.extend_from_slice(salt);
    out.extend_from_slice(nonce);
    out.extend_from_slice(&(ct.len() as u32).to_be_bytes());
    out.extend_from_slice(ct);
}

/// 写入加密备份文件。credentials_plain 为 Some 时写入独立加密段。
pub fn write_backup_file(
    path: &Path,
    zip_bytes: &[u8],
    credentials_plain: Option<&[u8]>,
    password: &str,
) -> AppResult<u64> {
    let mut file_bytes = Vec::with_capacity(zip_bytes.len() + 128);
    file_bytes.extend_from_slice(MAGIC);

    let salt1 = random_bytes(SALT_LEN);
    let (nonce1, ct1) = encrypt_segment(zip_bytes, password, &salt1)?;
    push_segment(&mut file_bytes, &salt1, &nonce1, &ct1);

    if let Some(creds) = credentials_plain {
        let salt2 = random_bytes(SALT_LEN);
        let (nonce2, ct2) = encrypt_segment(creds, password, &salt2)?;
        push_segment(&mut file_bytes, &salt2, &nonce2, &ct2);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, &file_bytes)?;
    Ok(file_bytes.len() as u64)
}

/// 解析备份文件。返回 (zip 字节, 凭证段明文或 None)。
pub fn read_backup_file(path: &Path, password: &str) -> AppResult<(Vec<u8>, Option<Vec<u8>>)> {
    let bytes = fs::read(path)?;
    if bytes.len() < MAGIC.len() || &bytes[..MAGIC.len()] != MAGIC {
        return Err(AppError::Invalid(
            "不是有效的 LCM 备份文件（魔数不匹配）".into(),
        ));
    }
    let mut cursor = MAGIC.len();

    let read_segment =
        |cursor: &mut usize| -> AppResult<([u8; SALT_LEN], [u8; NONCE_LEN], Vec<u8>)> {
            let need = SALT_LEN + NONCE_LEN + LEN_PREFIX;
            if bytes.len() < *cursor + need {
                return Err(AppError::Invalid("备份文件不完整".into()));
            }
            let mut salt = [0u8; SALT_LEN];
            salt.copy_from_slice(&bytes[*cursor..*cursor + SALT_LEN]);
            *cursor += SALT_LEN;
            let mut nonce = [0u8; NONCE_LEN];
            nonce.copy_from_slice(&bytes[*cursor..*cursor + NONCE_LEN]);
            *cursor += NONCE_LEN;
            let len = u32::from_be_bytes([
                bytes[*cursor],
                bytes[*cursor + 1],
                bytes[*cursor + 2],
                bytes[*cursor + 3],
            ]) as usize;
            *cursor += LEN_PREFIX;
            if bytes.len() < *cursor + len {
                return Err(AppError::Invalid("备份文件不完整（密文截断）".into()));
            }
            let ct = bytes[*cursor..*cursor + len].to_vec();
            *cursor += len;
            Ok((salt, nonce, ct))
        };

    let (salt1, nonce1, ct1) = read_segment(&mut cursor)?;
    let zip_bytes = decrypt_segment(&nonce1, &ct1, password, &salt1)?;

    let credentials = if cursor < bytes.len() {
        let (salt2, nonce2, ct2) = read_segment(&mut cursor)?;
        Some(decrypt_segment(&nonce2, &ct2, password, &salt2)?)
    } else {
        None
    };

    Ok((zip_bytes, credentials))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_with_and_without_credentials() {
        let dir = std::env::temp_dir().join(format!("lcm-backup-test-{}", std::process::id()));
        fs::create_dir_all(&dir).ok();
        let path = dir.join("t.lcmbackup");

        let payload = b"zip-bytes-here";
        let creds = br#"{"entries":[]}"#;

        write_backup_file(&path, payload, Some(creds), "pw123").unwrap();
        let (zip_back, creds_back) = read_backup_file(&path, "pw123").unwrap();
        assert_eq!(zip_back, payload);
        assert_eq!(creds_back.unwrap(), creds.to_vec());

        // 无凭证段
        write_backup_file(&path, payload, None, "pw").unwrap();
        let (zip_back, creds_back) = read_backup_file(&path, "pw").unwrap();
        assert_eq!(zip_back, payload);
        assert!(creds_back.is_none());

        // 错误密码 → 明确报错
        write_backup_file(&path, payload, Some(creds), "pw123").unwrap();
        assert!(read_backup_file(&path, "wrong").is_err());

        // 非法文件
        fs::write(&path, b"not-a-backup").unwrap();
        assert!(read_backup_file(&path, "pw123").is_err());

        fs::remove_dir_all(&dir).ok();
    }
}
