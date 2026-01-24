use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{AccountInfo, next_account_info},
    declare_id, entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

mod state;
use state::*;

enum CounterAction {
    Increment,
    Decrement,
}

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let (instruction_discriminant, instruction_data) = instruction_data.split_at(1);
    match instruction_discriminant[0] {
        0 => {
            msg!("Count incremented");
            update_counter(accounts, instruction_data, CounterAction::Increment)?;
        }
        1 => {
            msg!("Count decremented");
            update_counter(accounts, instruction_data, CounterAction::Decrement)?;
        }
        _ => {
            msg!("Error: invalid instruction");
        }
    }
    Ok(())
}

fn update_counter(
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
    action: CounterAction,
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();

    let counter_account = next_account_info(account_info_iter)?;
    assert!(
        counter_account.is_writable,
        "Counter account must be writable"
    );

    let mut counter = Counter::try_from_slice(&counter_account.try_borrow_mut_data()?)?;

    match action {
        CounterAction::Increment => counter.count += 1,
        CounterAction::Decrement => counter.count -= 1,
    }

    counter.serialize(&mut *counter_account.data.borrow_mut())?;

    msg!("Count updated to {:?}", counter.count);
    Ok(())
}
