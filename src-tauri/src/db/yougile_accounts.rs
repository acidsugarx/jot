#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::OnceLock;

#[cfg(not(test))]
use keyring::Entry;
use rusqlite::{params, Connection, OptionalExtension};
#[cfg(test)]
use std::sync::Mutex;

use super::utils::{db_error, timestamp};

#[cfg(not(test))]
const YOUGILE_KEYRING_SERVICE: &str = "dev.acidsugarx.jot.yougile";

#[cfg(test)]
static TEST_YOUGILE_KEYRING: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

#[cfg(test)]
fn store_yougile_api_key(account_id: &str, api_key: &str) -> Result<(), String> {
    let keyring = TEST_YOUGILE_KEYRING.get_or_init(|| Mutex::new(HashMap::new()));
    let mut keyring = keyring
        .lock()
        .map_err(|error| db_error("lock test keyring", error))?;
    keyring.insert(account_id.to_string(), api_key.to_string());
    Ok(())
}

#[cfg(not(test))]
fn store_yougile_api_key(account_id: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(YOUGILE_KEYRING_SERVICE, account_id)
        .map_err(|error| db_error("create Yougile keychain entry", error))?;
    entry
        .set_password(api_key)
        .map_err(|error| db_error("store Yougile API key in the system keychain", error))
}

#[cfg(test)]
fn load_yougile_api_key(account_id: &str) -> Result<Option<String>, String> {
    let keyring = TEST_YOUGILE_KEYRING.get_or_init(|| Mutex::new(HashMap::new()));
    let keyring = keyring
        .lock()
        .map_err(|error| db_error("lock test keyring", error))?;
    Ok(keyring.get(account_id).cloned())
}

#[cfg(not(test))]
fn load_yougile_api_key(account_id: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(YOUGILE_KEYRING_SERVICE, account_id)
        .map_err(|error| db_error("create Yougile keychain entry", error))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(db_error(
            "read Yougile API key from the system keychain",
            error,
        )),
    }
}

#[cfg(test)]
fn delete_yougile_api_key(account_id: &str) -> Result<(), String> {
    let keyring = TEST_YOUGILE_KEYRING.get_or_init(|| Mutex::new(HashMap::new()));
    let mut keyring = keyring
        .lock()
        .map_err(|error| db_error("lock test keyring", error))?;
    keyring.remove(account_id);
    Ok(())
}

#[cfg(not(test))]
fn delete_yougile_api_key(account_id: &str) -> Result<(), String> {
    let entry = Entry::new(YOUGILE_KEYRING_SERVICE, account_id)
        .map_err(|error| db_error("create Yougile keychain entry", error))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(db_error(
            "delete the Yougile API key from the system keychain",
            error,
        )),
    }
}

struct StoredYougileAccount {
    id: String,
    email: String,
    company_id: String,
    company_name: String,
    legacy_api_key: String,
    created_at: String,
}

fn list_stored_yougile_accounts(
    connection: &Connection,
) -> Result<Vec<StoredYougileAccount>, String> {
    let mut stmt = connection
        .prepare(
            "SELECT id, email, company_id, company_name, api_key, created_at FROM yougile_accounts ORDER BY created_at DESC",
        )
        .map_err(|error| db_error("prepare Yougile accounts query", error))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(StoredYougileAccount {
                id: row.get(0)?,
                email: row.get(1)?,
                company_id: row.get(2)?,
                company_name: row.get(3)?,
                legacy_api_key: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|error| db_error("query Yougile accounts", error))?;

    let accounts = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| db_error("read Yougile accounts", error))?;

    let mut deduped: Vec<StoredYougileAccount> = Vec::with_capacity(accounts.len());
    for account in accounts {
        let duplicate = deduped.iter().any(|existing| {
            existing.company_id == account.company_id
                && existing.email.eq_ignore_ascii_case(&account.email)
        });
        if !duplicate {
            deduped.push(account);
        }
    }

    Ok(deduped)
}

fn get_stored_yougile_account(
    connection: &Connection,
    account_id: &str,
) -> Result<StoredYougileAccount, String> {
    connection
        .query_row(
            "SELECT id, email, company_id, company_name, api_key, created_at FROM yougile_accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| {
                Ok(StoredYougileAccount {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    company_id: row.get(2)?,
                    company_name: row.get(3)?,
                    legacy_api_key: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|error| db_error("load Yougile account", error))
}

fn resolve_yougile_api_key(
    connection: &Connection,
    account_id: &str,
    legacy_api_key: &str,
) -> Result<String, String> {
    let legacy_api_key = legacy_api_key.trim();

    match load_yougile_api_key(account_id) {
        Ok(Some(api_key)) => {
            if legacy_api_key.is_empty() {
                if let Err(error) = connection.execute(
                    "UPDATE yougile_accounts SET api_key = ?1 WHERE id = ?2",
                    params![api_key, account_id],
                ) {
                    log::warn!(
                        "Failed to backfill legacy SQLite API key for account '{account_id}': {error}"
                    );
                }
            }
            return Ok(api_key);
        }
        Ok(None) => {}
        Err(error) => {
            log::warn!(
                "Failed to read Yougile API key from keychain for account '{account_id}': {error}"
            );
        }
    }

    if legacy_api_key.is_empty() {
        return Err(
            "Yougile account is missing its API key in keychain and local storage. Remove and re-add this account."
                .to_string(),
        );
    }

    if let Err(error) = store_yougile_api_key(account_id, legacy_api_key) {
        log::warn!(
            "Failed to migrate Yougile API key to keychain for account '{account_id}': {error}. Falling back to SQLite key."
        );
    }

    Ok(legacy_api_key.to_string())
}

fn recover_yougile_api_key_from_related_accounts(
    connection: &Connection,
    missing_account: &StoredYougileAccount,
) -> Result<Option<String>, String> {
    let mut stmt = connection
        .prepare(
            "SELECT id, email, company_id, company_name, api_key, created_at
             FROM yougile_accounts
             WHERE LOWER(email) = LOWER(?1) AND company_id = ?2 AND id != ?3
             ORDER BY created_at DESC",
        )
        .map_err(|error| db_error("prepare related Yougile account lookup", error))?;

    let candidates = stmt
        .query_map(
            params![
                &missing_account.email,
                &missing_account.company_id,
                &missing_account.id
            ],
            |row| {
                Ok(StoredYougileAccount {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    company_id: row.get(2)?,
                    company_name: row.get(3)?,
                    legacy_api_key: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|error| db_error("query related Yougile accounts", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| db_error("read related Yougile accounts", error))?;

    for candidate in candidates {
        let recovered_key =
            match resolve_yougile_api_key(connection, &candidate.id, &candidate.legacy_api_key) {
                Ok(key) => key,
                Err(_) => continue,
            };

        if missing_account.legacy_api_key.trim().is_empty() {
            if let Err(error) = connection.execute(
                "UPDATE yougile_accounts SET api_key = ?1 WHERE id = ?2",
                params![recovered_key, &missing_account.id],
            ) {
                log::warn!(
                    "Failed to backfill recovered API key into SQLite for account '{}': {error}",
                    missing_account.id
                );
            }
        }

        if let Err(error) = store_yougile_api_key(&missing_account.id, &recovered_key) {
            log::warn!(
                "Failed to backfill recovered API key into keychain for account '{}': {error}",
                missing_account.id
            );
        }

        log::warn!(
            "Recovered missing Yougile API key for account '{}' from related account '{}'",
            missing_account.id,
            candidate.id
        );
        return Ok(Some(recovered_key));
    }

    Ok(None)
}

pub fn get_yougile_accounts_impl(
    db: &super::DatabaseState,
) -> Result<Vec<crate::yougile::models::YougileAccount>, String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;

    list_stored_yougile_accounts(&conn).map(|accounts| {
        accounts
            .into_iter()
            .map(|account| crate::yougile::models::YougileAccount {
                id: account.id,
                email: account.email,
                company_id: account.company_id,
                company_name: account.company_name,
                created_at: account.created_at,
            })
            .collect()
    })
}

pub fn add_yougile_account_impl(
    db: &super::DatabaseState,
    email: &str,
    company_id: &str,
    company_name: &str,
    api_key: &str,
) -> Result<crate::yougile::models::YougileAccount, String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;
    let created_at = timestamp();
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM yougile_accounts WHERE LOWER(email) = LOWER(?1) AND company_id = ?2 ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![email, company_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| db_error("check existing Yougile account", error))?;
    let id = existing_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if existing_id.is_some() {
        conn.execute(
            "UPDATE yougile_accounts
             SET company_name = ?1, api_key = ?2, created_at = ?3
             WHERE id = ?4",
            rusqlite::params![company_name, api_key, created_at, id],
        )
        .map_err(|error| db_error("update existing Yougile account", error))?;
    } else {
        conn.execute(
            "INSERT INTO yougile_accounts (id, email, company_id, company_name, api_key, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, email, company_id, company_name, api_key, created_at],
        )
        .map_err(|error| db_error("insert Yougile account", error))?;
    }

    if let Err(error) = store_yougile_api_key(&id, api_key) {
        log::warn!(
            "Failed to store Yougile API key in keychain for account '{id}': {error}. Keeping legacy SQLite storage fallback."
        );
    }

    Ok(crate::yougile::models::YougileAccount {
        id,
        email: email.to_string(),
        company_id: company_id.to_string(),
        company_name: company_name.to_string(),
        created_at,
    })
}

pub fn remove_yougile_account_impl(
    db: &super::DatabaseState,
    account_id: &str,
) -> Result<(), String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM yougile_accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .map_err(|error| db_error("look up Yougile account", error))?;
    if exists == 0 {
        return Err("Account not found".to_string());
    }

    delete_yougile_api_key(account_id)?;

    let rows = conn
        .execute(
            "DELETE FROM yougile_accounts WHERE id = ?1",
            rusqlite::params![account_id],
        )
        .map_err(|error| db_error("delete Yougile account", error))?;
    if rows == 0 {
        return Err("Account not found".to_string());
    }
    Ok(())
}

pub fn get_yougile_account_api_key_impl(
    db: &super::DatabaseState,
    account_id: &str,
) -> Result<String, String> {
    let conn = db
        .connection
        .lock()
        .map_err(|error| db_error("lock SQLite connection", error))?;
    let account = get_stored_yougile_account(&conn, account_id)?;
    match resolve_yougile_api_key(&conn, &account.id, &account.legacy_api_key) {
        Ok(api_key) => Ok(api_key),
        Err(primary_error) => {
            if let Some(api_key) = recover_yougile_api_key_from_related_accounts(&conn, &account)? {
                return Ok(api_key);
            }
            Err(primary_error)
        }
    }
}
