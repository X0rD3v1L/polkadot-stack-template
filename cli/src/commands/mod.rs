pub mod chain;
pub mod contract;
pub mod pallet;

use blake2::digest::{consts::U32, Digest};
use blake2::Blake2b;
use std::fs;
use subxt::{OnlineClient, PolkadotConfig};
use subxt_signer::sr25519::dev;

type Blake2b256 = Blake2b<U32>;

const BULLETIN_WS: &str = "wss://paseo-bulletin-rpc.polkadot.io";

/// Resolve a hash from either a direct hex string or a file path.
/// Returns (hex_hash, Option<file_bytes>).
pub fn hash_input(
    hash: Option<String>,
    file: Option<&str>,
) -> Result<(String, Option<Vec<u8>>), Box<dyn std::error::Error>> {
    match (hash, file) {
        (Some(h), _) => Ok((h, None)),
        (None, Some(path)) => {
            let bytes = fs::read(path)?;
            let mut hasher = Blake2b256::new();
            hasher.update(&bytes);
            let result = hasher.finalize();
            let hex = format!("0x{}", hex::encode(result));
            println!("File: {path}");
            println!("Blake2b-256: {hex}");
            Ok((hex, Some(bytes)))
        }
        (None, None) => Err("Provide either a hash or --file <path>".into()),
    }
}

/// Upload file bytes to the Bulletin Chain via subxt dynamic API.
/// Signs with Alice dev account. Requires authorization on the Bulletin Chain.
pub async fn upload_to_bulletin(file_bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let max_size = 8 * 1024 * 1024;
    if file_bytes.len() > max_size {
        return Err(format!(
            "File too large ({:.1} MiB). Bulletin Chain max is 8 MiB.",
            file_bytes.len() as f64 / 1024.0 / 1024.0
        )
        .into());
    }

    println!("Connecting to Bulletin Chain ({BULLETIN_WS})...");
    let api = OnlineClient::<PolkadotConfig>::from_url(BULLETIN_WS).await?;

    println!(
        "Uploading {} bytes to Bulletin Chain (TransactionStorage.store)...",
        file_bytes.len()
    );
    println!(
        "Note: Requires authorization. Manage at: https://paritytech.github.io/polkadot-bulletin-chain/"
    );

    let signer = dev::alice();
    let tx = subxt::dynamic::tx(
        "TransactionStorage",
        "store",
        vec![("data", subxt::dynamic::Value::from_bytes(file_bytes))],
    );

    let result = api
        .tx()
        .sign_and_submit_then_watch_default(&tx, &signer)
        .await?
        .wait_for_finalized_success()
        .await?;

    println!(
        "Uploaded to Bulletin Chain! Finalized: {}",
        result.extrinsic_hash()
    );
    println!("File will be available on IPFS via the Paseo gateway.");

    Ok(())
}
