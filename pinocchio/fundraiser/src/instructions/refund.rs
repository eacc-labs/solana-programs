use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey,
};
use pinocchio_token::{instructions::Transfer, state::TokenAccount};

use crate::{
    error::FundraiserErrors,
    state::{Contributor, Fundraiser},
};

pub fn process_refund(accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [
        contributor,
        maker,
        mint_to_raise,
        fundraiser,
        contributor_account,
        contributor_ata,
        vault,
        token_program,
        system_program @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !contributor.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    {
        if fundraiser.owner() != &crate::ID {
            return Err(ProgramError::InvalidAccountOwner);
        }
        let fundraiser_state = Fundraiser::load(fundraiser)?;
        if fundraiser_state.mint_to_raise != *mint_to_raise.key() {
            return Err(ProgramError::InvalidAccountData);
        }

        let vault_state = TokenAccount::from_account_info(vault)?;
        if vault_state.mint() != mint_to_raise.key() {
            return Err(ProgramError::InvalidAccountData);
        }
        if vault_state.owner() != fundraiser.key() {
            return Err(ProgramError::InvalidAccountOwner);
        }
    }

    let (fundraiser_pda, bump) =
        pubkey::find_program_address(&[b"fundraiser", maker.key().as_ref()], &crate::ID);
    if fundraiser.key() != &fundraiser_pda {
        return Err(ProgramError::InvalidAccountData);
    }

    // Validate that contributor_account PDA is derived from the signer's key
    let (expected_contributor_pda, _bump) = pubkey::find_program_address(
        &[b"contributor", fundraiser.key().as_ref(), contributor.key().as_ref()],
        &crate::ID,
    );
    if contributor_account.key() != &expected_contributor_pda {
        return Err(FundraiserErrors::InvalidContributor.into());
    }

    let contributor_state = Contributor::load(contributor_account)?;
    let contributed_amount = u64::from_le_bytes(contributor_state.amount);
    if contributed_amount == 0 {
        return Err(FundraiserErrors::InvalidContribution.into());
    }

    let seed_bump = [bump];
    let seeds = [
        Seed::from(b"fundraiser"),
        Seed::from(maker.key().as_ref()),
        Seed::from(&seed_bump),
    ];
    let signer = Signer::from(&seeds);

    Transfer {
        from: vault,
        to: contributor_ata,
        amount: contributed_amount,
        authority: fundraiser,
    }
    .invoke_signed(&[signer])?;

    {
        let fundraiser_state_mut = Fundraiser::load_mut(fundraiser)?;
        let cur = u64::from_le_bytes(fundraiser_state_mut.current_amount);
        fundraiser_state_mut.current_amount = cur
            .checked_sub(contributed_amount)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .to_le_bytes();
    }

    {
        let contributor_state_mut = Contributor::load_mut(contributor_account)?;
        contributor_state_mut.amount = 0u64.to_le_bytes();
    }

    Ok(())
}
