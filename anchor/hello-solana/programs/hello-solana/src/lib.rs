use anchor_lang::prelude::*;

declare_id!("C6B9nB2B9pr9LsLGvHfBE6SgKtbs2BrHw1UkXUdmbseT");

#[program]
pub mod hello_solana {
    use super::*;

    pub fn hello(ctx: Context<Hello>) -> Result<()> {
        msg!("Hello, Solana from program: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Hello {}
