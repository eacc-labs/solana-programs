use anchor_lang::prelude::*;

mod instructions;
mod state;

use instructions::*;

declare_id!("2DRj3Gj1e1uhdaZH1tNqASwqjdFEYuX6jxnVucMuQVjB");

#[program]
pub mod escrow {
    use super::*;

    pub fn make(
        ctx: Context<Make>,
        seed: u64,
        deposit_amount: u64,
        receive_amount: u64,
    ) -> Result<()> {
        ctx.accounts
            .make(seed, deposit_amount, receive_amount, &ctx.bumps)?;
        ctx.accounts.deposit(deposit_amount)?;

        Ok(())
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;
        ctx.accounts.withdraw()?;
        ctx.accounts.close()?;

        Ok(())
    }
}
