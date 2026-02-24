# Security Audit Report: eacc-labs/solana-programs

**Auditor:** Ollie -- AI Security Auditor, [exoagent.xyz](https://exoagent.xyz)
**Date:** February 24, 2026
**Repository:** [eacc-labs/solana-programs](https://github.com/eacc-labs/solana-programs)
**Scope:** Anchor Escrow program, Pinocchio Fundraiser program
**Commit:** Initial audit against `main` branch

---

## Executive Summary

This audit identified **8 vulnerabilities** across two Solana programs in the `eacc-labs/solana-programs` repository: an Anchor-based escrow program and a Pinocchio (native) fundraiser program.

Of the 8 findings, **3 are Critical**, **4 are High**, and **1 is Medium** severity. The Critical findings include a missing token deposit in the escrow creation flow (rendering the escrow non-functional), an inverted fundraiser completion check (allowing fund withdrawal before the target is met), and a wrong mint account passed to a transfer CPI (which would cause runtime failure or incorrect token routing). The High-severity findings include PDA seed endianness mismatches that would cause signing failures, a missing error propagation on a CPI call, a rent lamport theft vector, and a missing PDA ownership validation that allows unauthorized refund claims.

All identified vulnerabilities have been fixed in the `security-fixes` branch accompanying this report.

---

## Methodology

1. **Manual Code Review:** Line-by-line review of all instruction handlers, account validation structs, and state definitions across both programs.
2. **Cross-Reference Analysis:** Verified consistency between PDA derivation seeds across `make`/`take` (escrow) and `contribute`/`refund`/`checker` (fundraiser) instruction pairs.
3. **CPI Verification:** Audited all Cross-Program Invocation calls for correct account passing, signer seed derivation, and error propagation.
4. **Account Constraint Validation:** Verified that all Anchor account constraints and manual Pinocchio validations correctly enforce ownership, mint association, and authority relationships.
5. **Economic Logic Review:** Traced token flow through all paths (deposit, withdraw, refund, fundraiser completion) to verify correct economic behavior.

---

## Findings

### Finding 1: Missing Deposit Call in Escrow Make Instruction

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Location** | `anchor/escrow/programs/escrow/src/lib.rs`, line 20-23 |
| **Status** | Fixed |

**Description:**
The `make` instruction initializes the escrow state (recording the maker, mints, deposit amount, and receive amount) but never actually transfers tokens from the maker into the vault. The `Make` implementation defines a `deposit()` method that performs the token transfer, but it is never called.

**Impact:**
The escrow vault is created empty. When a taker executes the `take` instruction, the `withdraw()` call attempts to transfer `escrow.deposit_amount` tokens from an empty vault, which will fail. The escrow program is completely non-functional -- makers create escrows that can never be fulfilled, and their tokens remain in their own ATA rather than being locked in the vault.

**Proof of Concept:**
1. Maker calls `make(seed=1, deposit_amount=1000, receive_amount=500)`.
2. Escrow account is created with `deposit_amount = 1000`, but the vault token account holds 0 tokens.
3. Taker calls `take()`. The `withdraw()` function attempts `transfer_checked` of 1000 tokens from a vault with 0 balance.
4. Transaction fails with insufficient funds error.

**Fix Applied:**
Added `ctx.accounts.deposit(deposit_amount)?;` call after `ctx.accounts.make()` in the `make` function in `lib.rs`.

---

### Finding 2: Incorrect Mint Constraint on maker_ata_y

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `anchor/escrow/programs/escrow/src/instructions/make.rs`, lines 24-29 |
| **Status** | Fixed |

**Description:**
The `maker_ata_y` account in the `Make` struct is constrained with `associated_token::mint = mint_x`, but it should be constrained with `associated_token::mint = mint_y`. The maker's ATA for token Y (the token they wish to receive) is being validated against mint X (the token they are depositing).

**Impact:**
The `maker_ata_y` field is validated as a `mint_x` associated token account. This means the account passed as `maker_ata_y` must actually be a `mint_x` ATA, not a `mint_y` ATA. When the taker later sends `mint_y` tokens to `maker_ata_y` (in the `take` instruction), the account would actually be a `mint_x` ATA, causing the transfer CPI to fail due to mint mismatch. This effectively prevents the escrow from being set up correctly if both maker ATAs are validated in the `make` instruction context.

**Proof of Concept:**
1. Maker has `mint_x` ATA and `mint_y` ATA.
2. When calling `make`, the `maker_ata_y` constraint requires `associated_token::mint = mint_x`.
3. The maker must pass their `mint_x` ATA as `maker_ata_y` (or the transaction fails).
4. Later in `take`, taker's deposit sends `mint_y` tokens to this account, but it's a `mint_x` ATA -- transfer fails.

**Fix Applied:**
Changed `associated_token::mint = mint_x` to `associated_token::mint = mint_y` on the `maker_ata_y` account constraint.

---

### Finding 3: Wrong Mint Account in Take Deposit Transfer

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Location** | `anchor/escrow/programs/escrow/src/instructions/take.rs`, line 74 |
| **Status** | Fixed |

**Description:**
In the `deposit()` method of the `Take` implementation, the `TransferChecked` CPI passes `self.maker_ata_y.to_account_info()` as the `mint` field. The `mint` field in `TransferChecked` must be the actual mint account, not a token account. The correct value is `self.mint_y.to_account_info()`.

**Impact:**
The `transfer_checked` CPI will fail at runtime because the Token program expects a Mint account in the mint field, not a TokenAccount. The SPL Token program will reject the transaction because the account data does not match the expected Mint layout. This makes the `take` instruction completely non-functional -- no taker can ever complete an escrow exchange.

**Proof of Concept:**
1. Taker calls `take()`.
2. `deposit()` constructs a `TransferChecked` with `mint: self.maker_ata_y.to_account_info()`.
3. SPL Token program attempts to deserialize `maker_ata_y` as a Mint account.
4. Deserialization fails (TokenAccount is 165 bytes with different layout than Mint's 82 bytes).
5. Transaction fails with an invalid account data error.

**Fix Applied:**
Changed `mint: self.maker_ata_y.to_account_info()` to `mint: self.mint_y.to_account_info()`.

---

### Finding 4: PDA Seed Endianness Mismatch in Take Instruction

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `anchor/escrow/programs/escrow/src/instructions/take.rs`, lines 97 and 124 |
| **Status** | Fixed |

**Description:**
The `withdraw()` and `close()` methods in the `Take` implementation use `self.escrow.seed.to_be_bytes()` (big-endian) to construct the PDA signer seeds. However, the escrow PDA is derived in `Make` and validated in `Take`'s account constraints using `escrow.seed.to_le_bytes()` (little-endian). This endianness mismatch means the signer seeds in `withdraw()` and `close()` produce a different PDA than the one that was created.

**Impact:**
Both `withdraw()` and `close()` will fail because the PDA derived from big-endian seed bytes does not match the escrow PDA derived from little-endian seed bytes. The Token program will reject the CPI because the provided signer does not match the vault's authority. All escrowed funds become permanently locked -- they can never be withdrawn or the vault closed.

**Proof of Concept:**
1. Escrow created with `seed = 1`. PDA derived with `1u64.to_le_bytes()` = `[0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]`.
2. Taker calls `take()`. `withdraw()` computes signer seeds with `1u64.to_be_bytes()` = `[0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]`.
3. Different seed bytes produce a different PDA address.
4. Token program rejects the transfer because the signer does not match the vault authority.
5. Same failure occurs in `close()`.

**Fix Applied:**
Changed `self.escrow.seed.to_be_bytes()` to `self.escrow.seed.to_le_bytes()` in both `withdraw()` (line 97) and `close()` (line 124).

---

### Finding 5: Vault Closure Rent Sent to Taker Instead of Maker

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `anchor/escrow/programs/escrow/src/instructions/take.rs`, lines 118-122 |
| **Status** | Fixed |

**Description:**
The `close()` method sends the vault account's rent-exempt lamports to `self.taker` instead of the maker. The maker is the party who funded the vault's creation (paid rent via `init` in the `Make` instruction). When the vault is closed after a successful escrow exchange, the rent lamports should be returned to the maker who originally paid them.

**Impact:**
The taker receives the rent lamports (~0.002 SOL for a token account) that the maker paid to create the vault. While the amount per transaction is small, this represents a systematic theft of rent from every maker who creates an escrow. Over many transactions, this becomes a meaningful loss for makers and an unearned gain for takers.

**Fix Applied:**
Added a `maker` account field to the `Take` struct with constraint `#[account(mut, address = escrow.maker)]` and changed the `CloseAccount` destination from `self.taker.to_account_info()` to `self.maker.to_account_info()`. The `maker` account is validated against `escrow.maker` via Anchor's `address` constraint.

---

### Finding 6: Inverted Target Check in Fundraiser Checker

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Location** | `pinocchio/fundraiser/src/instructions/checker.rs`, lines 52-55 |
| **Status** | Fixed |

**Description:**
The `process_checker` function is intended to allow the fundraiser maker to withdraw funds only after the fundraising target has been met. However, the comparison logic is inverted: `if vault_state.amount() >= amount_to_raise` returns `TargetNotMet` error. This means the function errors when the target IS met and succeeds when the target is NOT met.

**Impact:**
This is a complete inversion of the fundraiser's core safety invariant. The maker can withdraw all contributed funds before the fundraising goal is reached (i.e., at any time after even a single contribution). Conversely, once the target is actually met, the maker is permanently locked out of the funds. This allows fundraiser creators to rug-pull contributors by withdrawing partial funds, while legitimate successful fundraisers become irretrievable.

**Proof of Concept:**
1. Maker creates fundraiser with target of 1000 USDC.
2. Contributors deposit 100 USDC total (10% of target).
3. Maker calls `checker`. Vault amount (100) < target (1000), so the `>=` check is false, execution continues.
4. Maker successfully withdraws all 100 USDC before target is met.
5. Later, if the vault reaches 1000 USDC: vault amount (1000) >= target (1000), the check returns `TargetNotMet` error. Maker can never withdraw.

**Fix Applied:**
Changed `>=` to `<` so the function errors when vault amount is less than the target (i.e., when the target is genuinely not met).

---

### Finding 7: Missing Error Propagation on invoke_signed in Checker

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Location** | `pinocchio/fundraiser/src/instructions/checker.rs`, lines 83-89 |
| **Status** | Fixed |

**Description:**
The `invoke_signed` call for the token transfer in `process_checker` does not have the `?` operator to propagate errors. The return value of the CPI is silently discarded.

**Impact:**
If the token transfer CPI fails for any reason (insufficient balance, frozen account, invalid authority, etc.), the error is silently ignored. The `process_checker` function returns `Ok(())` regardless of whether the transfer actually succeeded. In combination with other state changes or downstream logic, this could lead to the program reporting success while funds were not actually transferred. While no state is mutated in `checker` beyond the transfer itself, this violates the principle of fail-fast error handling and could mask bugs during development and testing.

**Proof of Concept:**
1. Token transfer CPI fails (e.g., vault account is frozen).
2. `invoke_signed` returns `Err(...)`.
3. Error is discarded (no `?` operator).
4. `process_checker` returns `Ok(())`.
5. Client receives success confirmation despite no funds being transferred.

**Fix Applied:**
Added `?` after `.invoke_signed(&[signer])` to properly propagate CPI errors.

---

### Finding 8: Missing Contributor PDA Validation in Refund

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Location** | `pinocchio/fundraiser/src/instructions/refund.rs`, lines 59-63 (after fix) |
| **Status** | Fixed |

**Description:**
The `process_refund` function loads the `contributor_account` and checks that the contributed amount is non-zero, but it never validates that the `contributor_account` PDA is actually derived from the signing contributor's public key. The `contribute` instruction derives the contributor PDA from seeds `["contributor", fundraiser_key, contributor_key]`, but `refund` does not verify this relationship.

**Impact:**
An attacker can call `process_refund` with any valid `contributor_account` PDA (belonging to a different contributor) and claim their refund. Since the signer check only verifies that `contributor` is a signer (not that it matches the contributor account's owner), any signer can pass someone else's contributor PDA and redirect the refund to their own `contributor_ata`. This allows theft of all contributed funds during the refund period.

**Proof of Concept:**
1. Alice contributes 500 USDC. Her contributor PDA is derived from `["contributor", fundraiser, alice_pubkey]`.
2. Bob (attacker) calls `process_refund` with:
   - `contributor` = Bob's keypair (passes signer check)
   - `contributor_account` = Alice's contributor PDA (has 500 USDC recorded)
   - `contributor_ata` = Bob's USDC token account
3. No validation links Alice's PDA to Bob's signer key.
4. Bob receives Alice's 500 USDC refund.

**Fix Applied:**
Added PDA derivation validation before loading the contributor state:
```rust
let (expected_contributor_pda, _bump) = pubkey::find_program_address(
    &[b"contributor", fundraiser.key().as_ref(), contributor.key().as_ref()],
    &crate::ID,
);
if contributor_account.key() != &expected_contributor_pda {
    return Err(FundraiserErrors::InvalidContributor.into());
}
```
This ensures the contributor PDA passed to refund is derived from the actual signer's key, matching the derivation pattern used in `contribute`.

---

## Summary of Fixes

| # | Severity | Program | File | Description |
|---|----------|---------|------|-------------|
| 1 | CRITICAL | Escrow | `lib.rs` | Added missing `deposit()` call in `make` instruction |
| 2 | HIGH | Escrow | `make.rs` | Fixed `maker_ata_y` mint constraint from `mint_x` to `mint_y` |
| 3 | CRITICAL | Escrow | `take.rs` | Fixed mint account in deposit transfer CPI |
| 4 | HIGH | Escrow | `take.rs` | Fixed PDA seed endianness from `to_be_bytes` to `to_le_bytes` |
| 5 | HIGH | Escrow | `take.rs` | Fixed vault closure destination from taker to maker |
| 6 | CRITICAL | Fundraiser | `checker.rs` | Fixed inverted target comparison logic |
| 7 | MEDIUM | Fundraiser | `checker.rs` | Added error propagation on `invoke_signed` CPI |
| 8 | HIGH | Fundraiser | `refund.rs` | Added contributor PDA ownership validation |

**Severity Distribution:**
- Critical: 3
- High: 4
- Medium: 1

---

## Recommendations

1. **Add comprehensive integration tests** for all token flow paths -- particularly the full `make -> take` escrow lifecycle and the `contribute -> checker` / `contribute -> refund` fundraiser lifecycles.
2. **Consider using Anchor's `close` constraint** on the escrow account in the `Take` struct to handle escrow account closure and rent reclamation automatically.
3. **Add time-based expiry validation** in the escrow `take` instruction to prevent stale escrows from being filled after the maker may no longer want the trade.
4. **Add explicit `has_one` constraints** in Anchor where possible to make account relationships more explicit and self-documenting.
5. **Implement an `anchor_lang::prelude::require!` macro** for clearer assertion-style checks instead of manual if-return patterns.

---

*This audit was performed by Ollie -- AI Security Auditor, [exoagent.xyz](https://exoagent.xyz)*
