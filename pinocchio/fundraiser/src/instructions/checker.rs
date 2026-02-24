use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey,
};
use pinocchio_token::{instructions::Transfer, state::TokenAccount};

use crate::{error::FundraiserErrors, state::Fundraiser};

pub fn process_checker(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [
        maker,
        mint_to_raise,
        fundraiser,
        vault,
        maker_ata,
        token_program,
        system_program,
        _associated_token_program,
        _rent_sysvar @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate the Fundraiser account
    if fundraiser.owner() != &crate::ID {
        return Err(ProgramError::InvalidAccountOwner);
    }
    let fundraiser_state = Fundraiser::load(fundraiser)?; // getting the fundraiser account from here
    // Validating the mint
    if fundraiser_state.mint_to_raise != *mint_to_raise.key() {
        return Err(ProgramError::InvalidAccountData);
    }

    // validating the vault owner
    let vault_state = TokenAccount::from_account_info(vault)?;
    if vault_state.mint() != mint_to_raise.key() {
        return Err(ProgramError::InvalidAccountData);
    }
    if vault_state.owner() != fundraiser.key() {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Check if the target amount has been met
    let amount_to_raise = u64::from_le_bytes(fundraiser_state.amount_to_raise);
    if vault_state.amount() < amount_to_raise {
        return Err(FundraiserErrors::TargetNotMet.into());
    }

    // Validating the maker's token account
    let maker_ata_state = TokenAccount::from_account_info(maker_ata)?;
    if maker_ata_state.mint() != mint_to_raise.key() {
        return Err(ProgramError::InvalidAccountData);
    }
    if maker_ata_state.owner() != maker.key() {
        return Err(ProgramError::InvalidAccountOwner);
    }

    // Validating the fundraiser account
    let (fundraiser_pda, bump) =
        pubkey::find_program_address(&[b"fundraiser", &maker.key().as_ref()], &crate::ID);
    if fundraiser.key() != &fundraiser_pda {
        return Err(ProgramError::InvalidAccountData);
    }

    // Define the fundraiser PDA
    let seed_bump = &[bump];
    let signer_seeds = [
        Seed::from(b"fundraiser"),
        Seed::from(maker.key().as_ref()),
        Seed::from(seed_bump),
    ];
    let signer = Signer::from(&signer_seeds);

    // Transfering the vault funds to the maker's token account
    Transfer {
        from: vault,
        authority: fundraiser,
        to: maker_ata,
        amount: vault_state.amount(),
    }
    .invoke_signed(&[signer])?;

    Ok(())
}
