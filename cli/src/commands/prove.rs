use crate::commands::{
    hash_input, resolve_statement_signer, resolve_substrate_signer, submit_to_statement_store,
    upload_to_bulletin,
};
use alloy::providers::ProviderBuilder;
use alloy::sol;
use clap::Args;
use subxt::{OnlineClient, PolkadotConfig};

use super::contract::{get_contract_address, load_deployments, resolve_signer};

sol! {
    #[sol(rpc)]
    contract ProofOfExistence {
        function createClaim(bytes32 documentHash) external;
    }
}

#[derive(Args)]
pub struct ProveArgs {
    /// Path to the file to prove
    #[arg(long)]
    pub file: String,
    /// Create claim via pallet (default if --contract is not set)
    #[arg(long)]
    pub pallet: bool,
    /// Create claim via contract (evm or pvm)
    #[arg(long, value_parser = ["evm", "pvm"])]
    pub contract: Option<String>,
    /// Also upload the file to the Bulletin Chain (IPFS)
    #[arg(long)]
    pub bulletin: bool,
    /// Also submit the file to the Statement Store
    #[arg(long)]
    pub statement_store: bool,
    /// Signer: dev name (alice/bob/charlie), mnemonic, or 0x secret seed
    #[arg(long, short, default_value = "alice")]
    pub signer: String,
}

pub async fn run(
    args: ProveArgs,
    ws_url: &str,
    eth_rpc_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let (hash_hex, file_bytes) = hash_input(None, Some(&args.file))?;
    let file_bytes = file_bytes.unwrap();

    // Optional: upload to Bulletin Chain
    if args.bulletin {
        let keypair = resolve_substrate_signer(&args.signer)?;
        upload_to_bulletin(&file_bytes, &keypair).await?;
    }

    // Optional: submit to Statement Store
    if args.statement_store {
        let statement_signer = resolve_statement_signer(&args.signer)?;
        submit_to_statement_store(ws_url, &file_bytes, &statement_signer).await?;
    }

    // Create on-chain claim
    if let Some(contract_type) = &args.contract {
        // Contract path
        let deployments = load_deployments()?;
        let contract_addr = get_contract_address(&deployments, contract_type)?;
        let document_hash: alloy::primitives::FixedBytes<32> = hash_hex.parse()?;
        let wallet = alloy::network::EthereumWallet::from(resolve_signer(&args.signer)?);

        let provider = ProviderBuilder::new()
            .wallet(wallet)
            .connect_http(eth_rpc_url.parse()?);
        let contract = ProofOfExistence::new(contract_addr, &provider);

        println!(
            "Submitting createClaim to {} contract...",
            contract_type.to_uppercase()
        );
        let pending = contract.createClaim(document_hash).send().await?;
        let receipt = pending.get_receipt().await?;
        println!(
            "Confirmed in block {}: tx {}",
            receipt.block_number.unwrap_or_default(),
            receipt.transaction_hash
        );
    } else {
        // Pallet path (default)
        let api = OnlineClient::<PolkadotConfig>::from_url(ws_url).await?;
        let keypair = resolve_substrate_signer(&args.signer)?;
        let hash_bytes = parse_hash(&hash_hex)?;

        let tx = subxt::dynamic::tx(
            "TemplatePallet",
            "create_claim",
            vec![("hash", subxt::dynamic::Value::from_bytes(hash_bytes))],
        );
        let result = api
            .tx()
            .sign_and_submit_then_watch_default(&tx, &keypair)
            .await?
            .wait_for_finalized_success()
            .await?;
        println!(
            "create_claim finalized in block: {}",
            result.extrinsic_hash()
        );
    }

    Ok(())
}

fn parse_hash(hex: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    if hex.len() != 64 {
        return Err("Hash must be 32 bytes (64 hex characters)".into());
    }
    Ok((0..64)
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16))
        .collect::<Result<Vec<_>, _>>()?)
}
