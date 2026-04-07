use std::path::PathBuf;

use litesvm::LiteSVM;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

const SYSTEM_PROGRAM_ID: Pubkey = solana_sdk_ids::system_program::ID;

fn program_id() -> Pubkey {
    Pubkey::from(vault::ID)
}

struct Setup {
    svm: LiteSVM,
    owner: Keypair,
    vault_pda: Pubkey,
}

fn setup() -> Setup {
    let mut svm = LiteSVM::new();
    let owner = Keypair::new();

    svm.airdrop(&owner.pubkey(), 2 * LAMPORTS_PER_SOL)
        .expect("Airdrop failed");

    let so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/deploy/vault.so");
    svm.add_program_from_file(program_id(), so_path)
        .expect("Failed to load vault program");

    let (vault_pda, _) =
        Pubkey::find_program_address(&[b"vault", owner.pubkey().as_ref()], &program_id());

    // Pre-create PDA as a system account with zero lamports. The program expects this account to exist.
    svm.set_account(vault_pda, Account::new(0, 0, &SYSTEM_PROGRAM_ID))
        .expect("Failed to set vault PDA account");

    Setup {
        svm,
        owner,
        vault_pda,
    }
}

fn send_vault_ix(
    svm: &mut LiteSVM,
    owner: &Keypair,
    vault_pda: Pubkey,
    data: Vec<u8>,
) -> Result<(), String> {
    let ix = Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(owner.pubkey(), true),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data,
    };

    let message = Message::new(&[ix], Some(&owner.pubkey()));
    let tx = Transaction::new(&[owner], message, svm.latest_blockhash());

    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

#[test]
fn test_deposit_then_withdraw_success() {
    let mut setup = setup();

    let amount = 500_000_000u64;
    let mut deposit_data = vec![0u8];
    deposit_data.extend_from_slice(&amount.to_le_bytes());

    send_vault_ix(&mut setup.svm, &setup.owner, setup.vault_pda, deposit_data)
        .expect("Deposit failed");

    let vault_after_deposit = setup
        .svm
        .get_account(&setup.vault_pda)
        .expect("Vault account missing after deposit");
    assert_eq!(vault_after_deposit.lamports, amount);

    send_vault_ix(&mut setup.svm, &setup.owner, setup.vault_pda, vec![1u8])
        .expect("Withdraw failed");

    let vault_after_withdraw = setup
        .svm
        .get_account(&setup.vault_pda)
        .expect("Vault account missing after withdraw");
    assert_eq!(vault_after_withdraw.lamports, 0);
}

#[test]
fn test_deposit_zero_amount_fails() {
    let mut setup = setup();

    let mut deposit_data = vec![0u8];
    deposit_data.extend_from_slice(&0u64.to_le_bytes());

    let res = send_vault_ix(&mut setup.svm, &setup.owner, setup.vault_pda, deposit_data);
    assert!(res.is_err());
}

#[test]
fn test_withdraw_empty_vault_fails() {
    let mut setup = setup();

    let res = send_vault_ix(&mut setup.svm, &setup.owner, setup.vault_pda, vec![1u8]);
    assert!(res.is_err());
}
