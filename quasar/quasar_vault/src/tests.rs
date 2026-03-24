extern crate std;
use quasar_svm::{Account, ExecutionStatus, Instruction, Pubkey, QuasarSvm};
use solana_account::Account as SolanaAccount;
use quasar_vault_client::{DepositInstruction, WithdrawInstruction};

fn setup() -> QuasarSvm {
    let elf = include_bytes!("../target/deploy/quasar_vault.so");
    QuasarSvm::new()
        .with_program(&crate::ID, elf)
}

#[test]
fn test_deposit() {
    let mut svm = setup();
    let user = Pubkey::new_unique();
    let system_program = quasar_svm::system_program::ID;

    let (vault, _bump) = Pubkey::find_program_address(
        &[b"vault", user.as_ref()],
        &crate::ID,
    );

    let instruction: Instruction = DepositInstruction {
        user,
        vault,
        system_program,
        amount: 1_000_000_000,
    }
    .into();

    let result = svm.process_instruction(
        &instruction,
        &[
            Account::from_pair(user, SolanaAccount {
                lamports: 10_000_000_000,
                data: vec![],
                owner: system_program,
                executable: false,
                rent_epoch: 0,
            }),
            Account::from_pair(vault, SolanaAccount {
                lamports: 0,
                data: vec![],
                owner: crate::ID,
                executable: false,
                rent_epoch: 0,
            }),
        ],
    );

    match result.status() {
        ExecutionStatus::Success => {},
        ExecutionStatus::Err(e) => panic!("deposit failed: {e}"),
    }

    let user_after  = result.account(&user).unwrap();
    let vault_after = result.account(&vault).unwrap();

    assert_eq!(user_after.lamports,  9_000_000_000, "user should have 9 SOL after deposit");
    assert_eq!(vault_after.lamports, 1_000_000_000, "vault should have 1 SOL after deposit");
}

#[test]
fn test_withdraw() {
    let mut svm = setup();
    let user = Pubkey::new_unique();
    let system_program = quasar_svm::system_program::ID;

    let (vault, _bump) = Pubkey::find_program_address(
        &[b"vault", user.as_ref()],
        &crate::ID,
    );

    // Step 1: Deposit first
    let deposit_ix: Instruction = DepositInstruction {
        user,
        vault,
        system_program,
        amount: 1_000_000_000,
    }
    .into();

    let deposit_result = svm.process_instruction(
        &deposit_ix,
        &[
            Account::from_pair(user, SolanaAccount {
                lamports: 10_000_000_000,
                data: vec![],
                owner: system_program,
                executable: false,
                rent_epoch: 0,
            }),
            Account::from_pair(vault, SolanaAccount {
                lamports: 0,
                data: vec![],
                owner: crate::ID,
                executable: false,
                rent_epoch: 0,
            }),
        ],
    );

    match deposit_result.status() {
        ExecutionStatus::Success => {},
        ExecutionStatus::Err(e) => panic!("deposit failed: {e}"),
    }

    let user_after_deposit  = deposit_result.account(&user).unwrap().clone();
    let vault_after_deposit = deposit_result.account(&vault).unwrap().clone();

    // Step 2: Withdraw half
    let withdraw_ix: Instruction = WithdrawInstruction {
        user,
        vault,
        amount: 500_000_000,
    }
    .into();

    let withdraw_result = svm.process_instruction(
        &withdraw_ix,
        &[user_after_deposit, vault_after_deposit],
    );

    match withdraw_result.status() {
        ExecutionStatus::Success => {},
        ExecutionStatus::Err(e) => panic!("withdraw failed: {e}"),
    }

    let user_after  = withdraw_result.account(&user).unwrap();
    let vault_after = withdraw_result.account(&vault).unwrap();

    assert_eq!(user_after.lamports,  9_500_000_000, "user should have 9.5 SOL after withdraw");
    assert_eq!(vault_after.lamports,   500_000_000, "vault should have 0.5 SOL after withdraw");
}