import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { describe } from "mocha";

describe("vault", () => {
  const provider = anchor.getProvider();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;

  const user = anchor.web3.Keypair.generate();

  const [vaultStatePDA, vaultStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), user.publicKey.toBuffer()],
    program.programId
  );
  const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultStatePDA.toBuffer()],
    program.programId
  );

  before(async () => {
    await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it("Initialize vault", async () => {
    await program.methods
      .initialize()
      .accountsPartial({
        user: user.publicKey,
        vaultState: vaultStatePDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    const vaultState = await program.account.vaultState.fetch(vaultStatePDA);
    expect(vaultState.vaultBump).to.equal(vaultBump);

    const vaultBalance = await provider.connection.getBalance(vaultPDA);

    expect(vaultBalance).to.equal(0);
  });

  it("Deposit SOL in vault", async () => {
    const amount = 1 * LAMPORTS_PER_SOL;

    const userInitialBalance = await provider.connection.getBalance(
      user.publicKey
    );

    const vaultInitialBalance = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .deposit(new anchor.BN(amount))
      .accountsPartial({
        user: user.publicKey,
        vault: vaultPDA,
        vaultState: vaultStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const vaultFinalBalance = await provider.connection.getBalance(vaultPDA);
    const userFinalBalance = await provider.connection.getBalance(
      user.publicKey
    );

    expect(vaultFinalBalance).to.equal(vaultInitialBalance + amount);

    expect(userInitialBalance - userFinalBalance).to.be.at.least(amount);
  });

  it("Should fail when deposit 0 SOL in vault", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(0))
        .accountsPartial({
          user: user.publicKey,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });

  it("Successfully withdraw from vault", async () => {
    const amount = LAMPORTS_PER_SOL / 5;

    const userInitialBalance = await provider.connection.getBalance(
      user.publicKey
    );
    const vaultInitialBalance = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .withdraw(new anchor.BN(amount))
      .accountsPartial({
        user: user.publicKey,
        vault: vaultPDA,
        vaultState: vaultStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  });

  it("Should fail when withdrawing 0 SOL", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(0))
        .accountsPartial({
          user: user.publicKey,
          vault: vaultPDA,
          vaultState: vaultStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });

  it("Should fail when withdrawing more than balance", async () => {
    const vaultState = await program.account.vaultState.fetch(vaultStatePDA);
    const currentBalance = vaultState.balance.toNumber();
    const excessiveAmount = currentBalance + 1 * LAMPORTS_PER_SOL;

    try {
      await program.methods
        .withdraw(new anchor.BN(excessiveAmount))
        .accountsPartial({
          user: user.publicKey,
          vault: vaultPDA,
          vaultState: vaultStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.toString()).to.include("InsufficientBalance");
    }
  });

  it("Should fail to withdraw from uninitialized vault", async () => {
    const newUser = anchor.web3.Keypair.generate();

    await provider.connection.requestAirdrop(
      newUser.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [uninitializedVaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state"), newUser.publicKey.toBuffer()],
      program.programId
    );

    const [uninitializedVaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), uninitializedVaultStatePDA.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .withdraw(new anchor.BN(LAMPORTS_PER_SOL / 10))
        .accountsPartial({
          user: newUser.publicKey,
          vault: uninitializedVaultPDA,
          vaultState: uninitializedVaultStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([newUser])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.toString()).to.include("AccountNotInitialized");
    }
  });

  it("Withdraw remaining balance before closing", async () => {
    const vaultState = await program.account.vaultState.fetch(vaultStatePDA);
    const remainingBalance = vaultState.balance.toNumber();

    await program.methods
      .withdraw(new anchor.BN(remainingBalance))
      .accountsPartial({
        user: user.publicKey,
        vault: vaultPDA,
        vaultState: vaultStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify balance is now 0
    const finalVaultState = await program.account.vaultState.fetch(
      vaultStatePDA
    );
    expect(finalVaultState.balance.toNumber()).to.equal(0);
  });

  it("Close the vault", async () => {
    const initialVaultBalance = await provider.connection.getBalance(vaultPDA);
    const initialVaultStateBalance = await provider.connection.getBalance(
      vaultStatePDA
    );
    const initialUserBalance = await provider.connection.getBalance(
      user.publicKey
    );

    await program.methods
      .close()
      .accountsStrict({
        user: user.publicKey,
        vault: vaultPDA,
        vaultState: vaultStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const finalUserBalance = await provider.connection.getBalance(
      user.publicKey
    );

    expect(await provider.connection.getBalance(vaultPDA)).to.equal(0);

    const vaultStateInfo = await provider.connection.getAccountInfo(
      vaultStatePDA
    );
    expect(vaultStateInfo).to.be.null;

    expect(finalUserBalance).to.be.at.least(
      initialUserBalance +
        initialVaultBalance +
        initialVaultStateBalance -
        10000
    );
  });
});
