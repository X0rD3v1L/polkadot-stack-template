use clap::Subcommand;
use codec::{Decode, Encode};
use reqwest::Url;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sp_core::Pair;
use sp_statement_store::Statement;
use subxt::{OnlineClient, PolkadotConfig};

#[derive(Subcommand)]
pub enum ChainAction {
    /// Display chain information
    Info,
    /// Subscribe to new finalized blocks
    Blocks,
    /// Submit a test statement to the Statement Store RPC
    StatementSubmit {
        /// File whose bytes will be stored as statement data
        #[arg(long)]
        file: String,
        /// Signer for the statement proof
        #[arg(long, default_value = "alice")]
        signer: String,
        /// Submit without a signature proof to test runtime rejection
        #[arg(long)]
        unsigned: bool,
    },
    /// Dump known statements from the Statement Store RPC
    StatementDump,
}

pub async fn run(action: ChainAction, url: &str) -> Result<(), Box<dyn std::error::Error>> {
    match action {
        ChainAction::Info => {
            let api = OnlineClient::<PolkadotConfig>::from_url(url).await?;
            let genesis = api.genesis_hash();
            let runtime_version = api.runtime_version();
            println!("Chain Information");
            println!("=================");
            println!("Genesis Hash:    {genesis}");
            println!("Spec Version:    {}", runtime_version.spec_version);
            println!("TX Version:      {}", runtime_version.transaction_version);
        }
        ChainAction::Blocks => {
            let api = OnlineClient::<PolkadotConfig>::from_url(url).await?;
            println!("Subscribing to finalized blocks (Ctrl+C to stop)...");
            let mut blocks = api.blocks().subscribe_finalized().await?;
            while let Some(block) = blocks.next().await {
                let block = block?;
                println!("Block #{} - Hash: {}", block.number(), block.hash());
            }
        }
        ChainAction::StatementSubmit {
            file,
            signer,
            unsigned,
        } => {
            let bytes = std::fs::read(&file)?;
            let mut statement = Statement::new();
            statement.set_plain_data(bytes);

            if !unsigned {
                let signer = resolve_statement_signer(&signer)?;
                statement.sign_sr25519_private(&signer);
                println!("Using signer: 0x{}", hex::encode(signer.public()));
            } else {
                println!("Submitting an unsigned statement to test runtime rejection...");
            }

            let encoded = format!("0x{}", hex::encode(statement.encode()));
            let statement_hash = format!("0x{}", hex::encode(statement.hash()));

            rpc_call::<_, ()>(url, "statement_submit", vec![encoded]).await?;

            println!("Statement submitted successfully.");
            println!("Hash: {statement_hash}");
            println!("Data bytes: {}", statement.data_len());
        }
        ChainAction::StatementDump => {
            let encoded_statements: Vec<String> =
                rpc_call(url, "statement_dump", Vec::<String>::new()).await?;

            if encoded_statements.is_empty() {
                println!("No statements in the store.");
                return Ok(());
            }

            println!("Statements in store: {}", encoded_statements.len());
            for (index, encoded) in encoded_statements.iter().enumerate() {
                let raw = hex::decode(encoded.trim_start_matches("0x"))?;
                let statement = Statement::decode(&mut raw.as_slice())?;
                let account = statement
                    .account_id()
                    .map(hex::encode)
                    .unwrap_or_else(|| "none".to_string());

                println!(
                    "[{}] hash=0x{} account=0x{} bytes={} topics={} proof={}",
                    index,
                    hex::encode(statement.hash()),
                    account,
                    statement.data_len(),
                    topic_count(&statement),
                    statement.proof().is_some()
                );
            }
        }
    }

    Ok(())
}

fn topic_count(statement: &Statement) -> usize {
    (0..sp_statement_store::MAX_TOPICS)
        .take_while(|index| statement.topic(*index).is_some())
        .count()
}

fn resolve_statement_signer(
    input: &str,
) -> Result<sp_core::sr25519::Pair, Box<dyn std::error::Error>> {
    let uri = match input.to_lowercase().as_str() {
        "alice" => "//Alice",
        "bob" => "//Bob",
        "charlie" => "//Charlie",
        "dave" => "//Dave",
        "eve" => "//Eve",
        "ferdie" => "//Ferdie",
        _ => input,
    };

    sp_core::sr25519::Pair::from_string(uri, None)
        .map_err(|error| format!("Could not resolve statement signer {input}: {error}").into())
}

fn rpc_url(url: &str) -> Result<Url, Box<dyn std::error::Error>> {
    let mut rpc_url = Url::parse(url)?;
    match rpc_url.scheme() {
        "ws" => rpc_url
            .set_scheme("http")
            .expect("valid URL scheme conversion"),
        "wss" => rpc_url
            .set_scheme("https")
            .expect("valid URL scheme conversion"),
        "http" | "https" => {}
        scheme => return Err(format!("Unsupported RPC URL scheme: {scheme}").into()),
    }
    Ok(rpc_url)
}

async fn rpc_call<P: Serialize, R: DeserializeOwned>(
    url: &str,
    method: &str,
    params: P,
) -> Result<R, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let response: RpcResponse = client
        .post(rpc_url(url)?)
        .json(&RpcRequest {
            jsonrpc: "2.0",
            id: 1u32,
            method,
            params,
        })
        .send()
        .await?
        .json()
        .await?;

    match response.error {
        Some(error) => Err(error.to_string().into()),
        None => Ok(serde_json::from_value(response.result)?),
    }
}

#[derive(Serialize)]
struct RpcRequest<'a, P> {
    jsonrpc: &'static str,
    id: u32,
    method: &'a str,
    params: P,
}

#[derive(Deserialize)]
struct RpcResponse {
    #[serde(default)]
    result: serde_json::Value,
    #[serde(default)]
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i32,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.data {
            Some(data) => write!(f, "JSON-RPC error {}: {} ({data})", self.code, self.message),
            None => write!(f, "JSON-RPC error {}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for RpcError {}
