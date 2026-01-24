use anchor_lang::prelude::*;

declare_id!("hbJ8Kmhb8EZ2nHZ7nFhjDnKaAcWATycCmHr9WY4DaEo");

mod instructions;
mod state;

use instructions::*;

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.initialize()
    }

    pub fn update(ctx: Context<Update>, counter_action: CounterAction) -> Result<()> {
        ctx.accounts.update(counter_action)
    }
}
