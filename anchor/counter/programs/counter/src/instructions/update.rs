use crate::state::Counter;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub enum CounterAction {
    Increment,
    Decrement,
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub counter: Account<'info, Counter>,
}

impl<'info> Update<'info> {
    pub fn update(&mut self, action: CounterAction) -> Result<()> {
        match action {
            CounterAction::Increment => {
                self.counter.count += 1;
                msg!("Count incremented");
            }
            CounterAction::Decrement => {
                self.counter.count -= 1;
                msg!("Count decremented");
            }
        }

        Ok(())
    }
}
