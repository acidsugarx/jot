use super::client::YougileClient;
use super::models::{Company, YougileAccount};
use crate::db::DatabaseState;

/// Step 1 of login: get companies for credentials
pub async fn login_get_companies(login: &str, password: &str) -> Result<Vec<Company>, String> {
    YougileClient::get_companies(login, password).await
}

/// Step 2 of login: create API key for a specific company and store it
pub async fn add_account(
    db: &DatabaseState,
    login: &str,
    password: &str,
    company_id: &str,
    company_name: &str,
) -> Result<YougileAccount, String> {
    let api_key = YougileClient::create_api_key(login, password, company_id).await?;
    crate::db::add_yougile_account_impl(db, login, company_id, company_name, &api_key)
}

/// Get a YougileClient for a stored account
pub fn client_for_account(db: &DatabaseState, account_id: &str) -> Result<YougileClient, String> {
    let account = crate::db::get_yougile_account_by_id_impl(db, account_id)?;
    Ok(YougileClient::new(account.api_key))
}
