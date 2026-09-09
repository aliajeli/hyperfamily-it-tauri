//! Port of electron/services/crypto.service.js (SecureVault).
//!
//! Same payload formats: `dpapi:<base64>` (Windows DPAPI, user-scoped) and the
//! portable `aes:<iv>:<tag>:<ciphertext>` AES-256-GCM fallback. A fresh install
//! generates a 32-byte fallback key (`.vault-key`) and a 32-byte hex database
//! key (`.database-key`), both DPAPI-protected, exactly like the Electron app.

use crate::error::{AppError, AppResult};
use rand::RngCore;

pub struct SecureVault {
    key_path: std::path::PathBuf,
    database_key_path: std::path::PathBuf,
    fallback_key: parking_lot::Mutex<Option<Vec<u8>>>,
}

#[cfg(windows)]
fn dpapi_protect(plain: &[u8]) -> AppResult<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    use windows::Win32::Foundation::LocalFree;
    let input = CRYPT_INTEGER_BLOB { cbData: plain.len() as u32, pbData: plain.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            None,
            None,
            None,
            None,
            0,
            &mut out,
        )
        .map_err(|e| AppError::new(format!("DPAPI encryption failed: {e}")))?;
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let bytes = slice.to_vec();
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(out.pbData.cast()));
        Ok(bytes)
    }
}

#[cfg(windows)]
fn dpapi_unprotect(blob: &[u8]) -> AppResult<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    use windows::Win32::Foundation::LocalFree;
    let input = CRYPT_INTEGER_BLOB { cbData: blob.len() as u32, pbData: blob.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut out)
            .map_err(|e| AppError::new(format!("DPAPI decryption failed: {e}")))?;
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let bytes = slice.to_vec();
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(out.pbData.cast()));
        Ok(bytes)
    }
}

/// Constant-time equality (timingSafeEqual equivalent).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

impl SecureVault {
    pub fn new(user_data_path: &std::path::Path) -> Self {
        Self {
            key_path: user_data_path.join(".vault-key"),
            database_key_path: user_data_path.join(".database-key"),
            fallback_key: parking_lot::Mutex::new(None),
        }
    }

    pub fn has_database_key(&self) -> bool {
        self.database_key_path.exists()
    }

    pub fn get_database_key(&self) -> AppResult<String> {
        if self.has_database_key() {
            let blob = std::fs::read_to_string(&self.database_key_path)?;
            return self.decrypt(blob.trim());
        }
        let mut raw = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut raw);
        let key = hex::encode(raw);
        let protected = self.encrypt(&key)?;
        if let Some(parent) = self.database_key_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&self.database_key_path)
        {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(protected.as_bytes())?;
            }
            Err(_) => {
                // Lost a creation race (or the file appeared between checks):
                // read back whatever key is there now.
                let blob = std::fs::read_to_string(&self.database_key_path)?;
                return self.decrypt(blob.trim());
            }
        }
        Ok(key)
    }

    fn get_fallback_key(&self) -> AppResult<Vec<u8>> {
        let mut cached = self.fallback_key.lock();
        if let Some(key) = cached.as_ref() {
            return Ok(key.clone());
        }
        let key = if self.key_path.exists() {
            std::fs::read(&self.key_path)?
        } else {
            let mut raw = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut raw);
            if let Some(parent) = self.key_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&self.key_path) {
                Ok(mut file) => {
                    use std::io::Write;
                    file.write_all(&raw)?;
                }
                Err(_) => {
                    let existing = std::fs::read(&self.key_path)?;
                    raw.copy_from_slice(&existing[..32.min(existing.len())]);
                }
            }
            raw.to_vec()
        };
        if key.len() != 32 {
            return Err(AppError::new("Invalid local encryption key"));
        }
        *cached = Some(key.clone());
        Ok(key)
    }

    pub fn encrypt(&self, value: &str) -> AppResult<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        #[cfg(windows)]
        {
            if let Ok(protected) = dpapi_protect(value.as_bytes()) {
                use base64::Engine;
                return Ok(format!("dpapi:{}", base64::engine::general_purpose::STANDARD.encode(protected)));
            }
        }
        use base64::Engine;
        let key = self.get_fallback_key()?;
        let mut iv = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut iv);
        let mut cipher = openssl::symm::Crypter::new(
            openssl::symm::Cipher::aes_256_gcm(),
            openssl::symm::Mode::Encrypt,
            &key,
            Some(&iv),
        )?;
        let mut ciphertext = vec![0u8; value.len() + 16];
        let mut written = cipher.update(value.as_bytes(), &mut ciphertext)?;
        written += cipher.finalize(&mut ciphertext[written..])?;
        ciphertext.truncate(written);
        let mut tag = vec![0u8; 16];
        cipher.get_tag(&mut tag)?;
        Ok(format!(
            "aes:{}:{}:{}",
            base64::engine::general_purpose::STANDARD.encode(iv),
            base64::engine::general_purpose::STANDARD.encode(tag),
            base64::engine::general_purpose::STANDARD.encode(ciphertext)
        ))
    }

    pub fn decrypt(&self, payload: &str) -> AppResult<String> {
        use base64::Engine;
        let payload = payload.trim();
        if payload.is_empty() {
            return Ok(String::new());
        }
        if let Some(blob) = payload.strip_prefix("dpapi:") {
            let _bytes = base64::engine::general_purpose::STANDARD.decode(blob.trim())
                .map_err(|e| AppError::new(format!("Invalid encrypted payload: {e}")))?;
            #[cfg(windows)]
            {
                let plain = dpapi_unprotect(&bytes)?;
                return Ok(String::from_utf8_lossy(&plain).to_string());
            }
            #[cfg(not(windows))]
            return Err(AppError::new("DPAPI payloads can only be decrypted on Windows"));
        }
        if payload.starts_with("aes:") {
            let parts: Vec<&str> = payload.split(':').collect();
            if parts.len() != 4 {
                return Err(AppError::new("Invalid encrypted payload"));
            }
            let key = self.get_fallback_key()?;
            let iv = base64::engine::general_purpose::STANDARD.decode(parts[1])?;
            let tag = base64::engine::general_purpose::STANDARD.decode(parts[2])?;
            let ciphertext = base64::engine::general_purpose::STANDARD.decode(parts[3])?;
            let mut decipher = openssl::symm::Crypter::new(
                openssl::symm::Cipher::aes_256_gcm(),
                openssl::symm::Mode::Decrypt,
                &key,
                Some(&iv),
            )?;
            let mut plain = vec![0u8; ciphertext.len() + 16];
            let mut written = decipher.update(&ciphertext, &mut plain)?;
            decipher.set_tag(&tag).map_err(AppError::from)?;
            written += decipher.finalize(&mut plain[written..])?;
            plain.truncate(written);
            return Ok(String::from_utf8_lossy(&plain).to_string());
        }
        // Migration compatibility: unrecognised payloads pass through unchanged.
        Ok(payload.to_string())
    }
}

/// Port of AppDatabase.hashPin / verifyPinHash: `scrypt:<salt hex>:<hash hex>`,
/// 32-byte key, salt 16 bytes — matching Node's crypto.scryptSync defaults
/// (N=16384, r=8, p=1), which is what the recovery PIN historically used.
pub fn hash_pin(pin: &str) -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut derived = [0u8; 32];
    let params = scrypt::Params::new(14, 8, 1, 32).expect("fixed scrypt params");
    scrypt::scrypt(pin.as_bytes(), &salt, &params, &mut derived).expect("scrypt works");
    format!("scrypt:{}:{}", hex::encode(salt), hex::encode(derived))
}

pub fn verify_pin_hash(pin: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 3 || parts[0] != "scrypt" || parts[1].is_empty() || parts[2].is_empty() {
        return false;
    }
    let Ok(salt) = hex::decode(parts[1]) else { return false };
    let Ok(expected) = hex::decode(parts[2]) else { return false };
    let mut derived = [0u8; 32];
    let Ok(params) = scrypt::Params::new(14, 8, 1, expected.len()) else { return false };
    if scrypt::scrypt(pin.as_bytes(), &salt, &params, &mut derived).is_err() {
        return false;
    }
    ct_eq(&derived[..expected.len()], &expected)
}
