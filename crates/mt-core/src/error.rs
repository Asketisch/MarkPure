use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Encoding error: {0}")]
    Encoding(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Document not found")]
    DocumentNotFound,

    #[error("No file path set")]
    NoFilePath,
}

pub type Result<T> = std::result::Result<T, Error>;
