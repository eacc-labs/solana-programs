# quasar_vault

A Solana smart contract built with **[Quasar](https://quasar-lang.com)** that lets users deposit and withdraw SOL into a personal vault secured by a PDA (Program Derived Address).

---

## ⚡ What is Quasar?

Quasar is a Solana program development framework for writing blazing fast SVM programs. Programs are `#![no_std]` by default — accounts are pointer-cast directly from the SVM input buffer with no deserialization, no heap allocation, and no copies.

You write `#[program]`, `#[account]`, and `#[derive(Accounts)]` like Anchor, but the generated code compiles down to near-hand-written CU efficiency.

Built by **[@blueshift](https://x.com/blueshift)** — [github.com/blueshift-gg/quasar](https://github.com/blueshift-gg/quasar)

---

## 📁 Project Structure

```
quasar_vault/
├── src/
│   ├── lib.rs                  # Program entrypoint — declares instructions
│   ├── instructions/
│   │   ├── mod.rs              # Exports all instructions
│   │   ├── deposit.rs          # Deposit instruction logic
│   │   └── withdraw.rs         # Withdraw instruction logic
│   └── tests.rs                # Integration tests using QuasarSvm
├── Cargo.toml
├── Quasar.toml
└── README.md
```

---

## ⚙️ How It Works

Each user gets their own **vault** — a PDA derived from their wallet address:

```
vault PDA = ["vault", user_pubkey]  owned by quasar_vault program
```

- **Deposit** — User transfers SOL from their wallet into their vault via the system program
- **Withdraw** — Program transfers SOL back from the vault to the user

---

## 📜 Instructions

### Deposit

```rust
#[instruction(discriminator = 0)]
pub fn deposit(ctx: Ctx<Deposit>, amount: u64) -> Result<(), ProgramError>
```

| Account | Type | Description |
|---|---|---|
| `user` | `Signer` | The user depositing SOL |
| `vault` | `UncheckedAccount` | PDA vault — seeds: `["vault", user]` |
| `system_program` | `Program<System>` | Solana system program for CPI transfer |

### Withdraw

```rust
#[instruction(discriminator = 1)]
pub fn withdraw(ctx: Ctx<Withdraw>, amount: u64) -> Result<(), ProgramError>
```

| Account | Type | Description |
|---|---|---|
| `user` | `Signer` | The user withdrawing SOL |
| `vault` | `UncheckedAccount` | PDA vault — seeds: `["vault", user]` |

---

## 🚀 Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Quasar CLI](https://quasar-lang.com/docs/installation)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)

### Install

```bash
git clone https://github.com/mishalturkane/quasar_vault
cd quasar_vault
```

---

## 🛠️ CLI Commands

### Build

Compiles the program to a `.so` binary:

```bash
quasar build
```

Output: `target/deploy/quasar_vault.so`

### Test

Runs integration tests using the local QuasarSvm simulator. No real SOL is used:

```bash
quasar test
```

> **Note:** Always run `quasar build` before `quasar test` so the `.so` file exists.

### Profile

Gives a per-instruction CU (Compute Unit) breakdown with an interactive flamegraph:

```bash
quasar profile
```

Output example:
```
quasar_vault  484 CU
     441  91.1%  entrypoint
      43   8.9%  [unknown]

flamegraph  http://127.0.0.1:7777/?program=quasar_vault
```

### Deploy

```bash
# Get free devnet SOL first
solana airdrop 2 --url devnet

# Deploy to devnet
quasar deploy --devnet

# Deploy to mainnet
quasar deploy --mainnet
```

---

## 🧪 Tests

Tests are written using `QuasarSvm` — a local Solana VM that runs entirely in memory. **No real SOL is used during tests.**

Located in `src/tests.rs`.

### `test_deposit`

```
User  starts : 10 SOL
Deposits     :  1 SOL  →  vault
──────────────────────────────────
User  after  :  9 SOL
Vault after  :  1 SOL
```

### `test_withdraw`

```
User  starts : 10 SOL
Deposits     :  1 SOL  →  vault
Withdraws    :  0.5 SOL ← vault
──────────────────────────────────
User  after  :  9.5 SOL
Vault after  :  0.5 SOL
```

### Key Points About Tests

- `Account::from_pair` creates fake in-memory accounts with any balance
- Vault must be owned by `crate::ID` so the program can debit it on withdraw
- PDA derived with `Pubkey::find_program_address(&[b"vault", user.as_ref()], &crate::ID)`
- `assert_eq!` verifies exact lamport values after each operation

---

## 🔑 Key Concepts

### PDA (Program Derived Address)

A special account address with no private key — only the owning program can sign for it:

```rust
let (vault, _bump) = Pubkey::find_program_address(
    &[b"vault", user.as_ref()],
    &crate::ID,
);
```

### Why vault owner must be `crate::ID`

Only the **owner** of an account can debit its lamports. Setting vault owner to your program ID ensures only your program can withdraw from it — not any random caller.

### Lamports ↔ SOL

```
1 SOL = 1,000,000,000 lamports
```

---

## 📦 Dependencies

```toml
[dependencies]
quasar-lang        = { git = "https://github.com/blueshift-gg/quasar" }
solana-instruction = { version = "3.2.0" }

[dev-dependencies]
quasar_vault-client = { path = "target/client/rust/quasar_vault-client" }
quasar-svm          = { git = "https://github.com/blueshift-gg/quasar-svm" }
solana-account      = { version = "3.4.0" }
solana-address      = { version = "2.2.0", features = ["decode"] }
solana-instruction  = { version = "3.2.0", features = ["bincode"] }
solana-pubkey       = { version = "4.1.0" }
```

---

## 🛠️ Built With

- [Quasar](https://quasar-lang.com) — Blazing fast Solana program framework by [@blueshift](https://x.com/blueshift)
- [QuasarSvm](https://github.com/blueshift-gg/quasar-svm) — Local Solana VM for testing
- [Rust](https://www.rust-lang.org) — Systems programming language

---

## 📄 License

MIT