use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{errors::VaultError, state::VaultState};

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault_state", user.key().as_ref()],
        bump,
        constraint = vault_state.owner == user.key(),
        close = user
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Close<'info> {
    pub fn close(&mut self) -> Result<()> {
        require!(self.vault_state.balance == 0, VaultError::VaultNotEmpty);

        let vault_lamports = self.vault.lamports();

        if vault_lamports > 0 {
            let cpi_program = self.system_program.to_account_info();
            let cpi_accounts = Transfer {
                from: self.vault.to_account_info(),
                to: self.user.to_account_info(),
            };

            let bump_seeds = self.vault_state.vault_bump;
            let signer_seeds: &[&[&[u8]]] = &[&[
                b"vault",
                self.vault_state.to_account_info().key.as_ref(),
                &[bump_seeds],
            ]];

            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            transfer(cpi_ctx, vault_lamports)?;
        }
        Ok(())
    }
}
