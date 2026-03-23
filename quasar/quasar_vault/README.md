# Quasar Vault

A minimal Solana vault program built with the [Quasar Lang](https://github.com/quasar-lang) framework. Users can deposit SOL into a personal PDA vault and withdraw it at any time.

## Program Overview

The program exposes two instructions:

- **Deposit** — Transfers SOL from the user's wallet into a PDA vault via a system program transfer.
- **Withdraw** — Moves SOL from the PDA vault back to the user by directly adjusting lamports.

Each user's vault is derived from the seeds `["vault", user_pubkey]`, ensuring one vault per wallet.

## Project Structure

```
├── programs/
│   └── quasar_vault/
│       └── src/
│           ├── deposit.rs      # Deposit instruction handler
│           └── withdraw.rs     # Withdraw instruction handler
            └── tests.rs        # Integration tests using quasar_svm
```

## Building

```sh
quasar build
```

## Testing

Tests use `quasar_svm` to simulate on-chain execution locally.

```sh
 quasar test
```

## Check CU's

check how much cu's is taken by this quasar program

```sh
 cargo profile
```


# quasar_vault
