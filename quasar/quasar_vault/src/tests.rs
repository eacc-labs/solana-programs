extern crate std;

use quasar_svm::{Account, Instruction, Pubkey, QuasarSvm};
use solana_account::Account as SolanaAccount;

use quasar_vault_client::{DepositInstruction, WithdrawInstruction};

const SYSTEM_PROGRAM: Pubkey = quasar_svm::system_program::ID;

fn make_account(address: Pubkey, lamports: u64, owner: &Pubkey) -> Account {
    Account::from_pair(
        address,
        SolanaAccount {
            lamports,
            data: vec![],
            owner: *owner,
            executable: false,
            rent_epoch: 0,
        },
    )
}

fn setup() -> QuasarSvm {
    let elf = include_bytes!("../target/deploy/quasar_vault.so");
    QuasarSvm::new().with_program(&crate::ID, elf)
}

#[test]
fn test_deposit() {
    let mut svm = setup();

    let user = Pubkey::new_unique();
    let (vault, _) = Pubkey::find_program_address(&[b"vault", user.as_ref()], &crate::ID);

    let deposit_amount: u64 = 2_500_000_000;

    let user_account = make_account(user, 7_000_000_000, &SYSTEM_PROGRAM);
    let vault_account = make_account(vault, 0, &SYSTEM_PROGRAM);

    let instruction: Instruction = DepositInstruction {
        user,
        vault,
        system_program: SYSTEM_PROGRAM,
        amount: deposit_amount,
    }
    .into();

    let result = svm.process_instruction(&instruction, &[user_account, vault_account]);
    result.assert_success();

    let user_after = result.account(&user).unwrap();
    let vault_after = result.account(&vault).unwrap();

    assert_eq!(user_after.lamports, 7_000_000_000 - deposit_amount);
    assert_eq!(vault_after.lamports, deposit_amount);
}

#[test]
fn test_withdraw() {
    let mut svm = setup();

    let user = Pubkey::new_unique();
    let (vault, _) = Pubkey::find_program_address(&[b"vault", user.as_ref()], &crate::ID);

    let withdraw_amount: u64 = 2_000_000_000;

    let user_account = make_account(user, 5_000_000_000, &SYSTEM_PROGRAM);
    let vault_account = make_account(vault, 3_000_000_000, &crate::ID);

    let instruction: Instruction = WithdrawInstruction {
        user,
        vault,
        amount: withdraw_amount,
    }
    .into();

    let result = svm.process_instruction(&instruction, &[user_account, vault_account]);
    result.assert_success();

    let user_after = result.account(&user).unwrap();
    let vault_after = result.account(&vault).unwrap();

    assert_eq!(user_after.lamports, 5_000_000_000 + withdraw_amount);
    assert_eq!(vault_after.lamports, 3_000_000_000 - withdraw_amount);
}