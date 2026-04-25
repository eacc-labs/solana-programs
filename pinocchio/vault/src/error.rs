use pinocchio::program_error::ProgramError;

#[repr(u32)]
pub enum VaultErrors {
	InvalidAmount = 0x0,
	VaultNotEmpty = 0x1,
	VaultEmpty = 0x2,
}

impl From<VaultErrors> for ProgramError {
	fn from(e: VaultErrors) -> Self {
		ProgramError::Custom(e as u32)
	}
}

impl VaultErrors {
	pub fn description(&self) -> &'static str {
		match self {
			VaultErrors::InvalidAmount => "Invalid amount",
			VaultErrors::VaultNotEmpty => "Vault is not empty",
			VaultErrors::VaultEmpty => "Vault is empty",
		}
	}
}
