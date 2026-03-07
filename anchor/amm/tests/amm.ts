import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";
import { describe } from "mocha";

describe("amm", () => {
  const provider = anchor.getProvider();
  anchor.setProvider(provider);

  const program = anchor.workspace.Amm as Program<Amm>;

  const initializer = anchor.web3.Keypair.generate();
  const user = anchor.web3.Keypair.generate();

  const SEED = new anchor.BN(42);
  const FEE = 300;
  const DECIMALS = 6;
  const UNIT = 10 ** DECIMALS;

  let mintX: PublicKey;
  let mintY: PublicKey;

  // Derived after mints are created
  let configPDA: PublicKey;
  let mintLpPDA: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;
  let initializerAtaX: PublicKey;
  let initializerAtaY: PublicKey;
  let initializerAtaLp: PublicKey;
  let userAtaX: PublicKey;
  let userAtaY: PublicKey;
  let userAtaLp: PublicKey;

  before(async () => {
    await provider.connection.requestAirdrop(
      initializer.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      user.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    mintX = await createMint(
      provider.connection,
      initializer,
      initializer.publicKey,
      null,
      DECIMALS
    );

    mintY = await createMint(
      provider.connection,
      initializer,
      initializer.publicKey,
      null,
      DECIMALS
    );

    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), SEED.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    [mintLpPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), configPDA.toBuffer()],
      program.programId
    );

    vaultX = getAssociatedTokenAddressSync(mintX, configPDA, true);
    vaultY = getAssociatedTokenAddressSync(mintY, configPDA, true);

    initializerAtaX = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        initializer,
        mintX,
        initializer.publicKey
      )
    ).address;

    initializerAtaY = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        initializer,
        mintY,
        initializer.publicKey
      )
    ).address;

    userAtaX = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        mintX,
        user.publicKey
      )
    ).address;

    userAtaY = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        mintY,
        user.publicKey
      )
    ).address;

    await mintTo(
      provider.connection,
      initializer,
      mintX,
      initializerAtaX,
      initializer,
      1_000_000 * UNIT
    );
    await mintTo(
      provider.connection,
      initializer,
      mintY,
      initializerAtaY,
      initializer,
      1_000_000 * UNIT
    );
    await mintTo(
      provider.connection,
      initializer,
      mintX,
      userAtaX,
      initializer,
      1_000_000 * UNIT
    );
    await mintTo(
      provider.connection,
      initializer,
      mintY,
      userAtaY,
      initializer,
      1_000_000 * UNIT
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it("Initialize the AMM pool", async () => {
    await program.methods
      .initialize(SEED, FEE, null)
      .accountsPartial({
        initializer: initializer.publicKey,
        mintX,
        mintY,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        config: configPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([initializer])
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.seed.toString()).to.equal(SEED.toString());
    expect(config.fee).to.equal(FEE);
    expect(config.mintX.toBase58()).to.equal(mintX.toBase58());
    expect(config.mintY.toBase58()).to.equal(mintY.toBase58());
    expect(config.locked).to.equal(false);
    expect(config.authority).to.be.null;

    const lpMintInfo = await getMint(provider.connection, mintLpPDA);
    expect(lpMintInfo.decimals).to.equal(6);
    expect(lpMintInfo.supply.toString()).to.equal("0");

    const vXBalance = await provider.connection.getTokenAccountBalance(vaultX);
    const vYBalance = await provider.connection.getTokenAccountBalance(vaultY);
    expect(vXBalance.value.uiAmount).to.equal(0);
    expect(vYBalance.value.uiAmount).to.equal(0);
  });

  it("Should fail to initialize with fee greater than 10000", async () => {
    const badSeed = new anchor.BN(998);
    const [badConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), badSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [badMintLp] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), badConfig.toBuffer()],
      program.programId
    );
    const badVaultX = getAssociatedTokenAddressSync(mintX, badConfig, true);
    const badVaultY = getAssociatedTokenAddressSync(mintY, badConfig, true);

    try {
      await program.methods
        .initialize(badSeed, 10001, null)
        .accountsPartial({
          initializer: initializer.publicKey,
          mintX,
          mintY,
          mintLp: badMintLp,
          vaultX: badVaultX,
          vaultY: badVaultY,
          config: badConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      const msg = error?.error?.errorCode?.code ?? error.toString();
      expect(msg).to.include("InvalidFee");
    }
  });

  it("Initial deposit fills vaults and mints LP tokens", async () => {
    initializerAtaLp = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        initializer,
        mintLpPDA,
        initializer.publicKey,
        true
      )
    ).address;

    const LP_AMOUNT = new anchor.BN(100_000 * UNIT);
    const MAX_X = new anchor.BN(500_000 * UNIT);
    const MAX_Y = new anchor.BN(500_000 * UNIT);

    const preVaultX = await provider.connection.getTokenAccountBalance(vaultX);
    const preVaultY = await provider.connection.getTokenAccountBalance(vaultY);
    const preUserX = await provider.connection.getTokenAccountBalance(
      initializerAtaX
    );
    const preUserY = await provider.connection.getTokenAccountBalance(
      initializerAtaY
    );

    await program.methods
      .deposit(LP_AMOUNT, MAX_X, MAX_Y)
      .accountsPartial({
        user: initializer.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: initializerAtaX,
        userY: initializerAtaY,
        userLp: initializerAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    const postVaultX = await provider.connection.getTokenAccountBalance(vaultX);
    const postVaultY = await provider.connection.getTokenAccountBalance(vaultY);
    const postUserX = await provider.connection.getTokenAccountBalance(
      initializerAtaX
    );
    const postUserY = await provider.connection.getTokenAccountBalance(
      initializerAtaY
    );
    const postUserLp = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );

    expect(Number(postVaultX.value.amount)).to.be.greaterThan(
      Number(preVaultX.value.amount)
    );
    expect(Number(postVaultY.value.amount)).to.be.greaterThan(
      Number(preVaultY.value.amount)
    );
    expect(Number(postUserX.value.amount)).to.be.lessThan(
      Number(preUserX.value.amount)
    );
    expect(Number(postUserY.value.amount)).to.be.lessThan(
      Number(preUserY.value.amount)
    );
    expect(postUserLp.value.amount).to.equal(LP_AMOUNT.toString());
  });

  it("Second deposit mints proportional LP tokens", async () => {
    const LP_AMOUNT = new anchor.BN(50_000 * UNIT);

    const preLp = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );

    await program.methods
      .deposit(
        LP_AMOUNT,
        new anchor.BN(500_000 * UNIT),
        new anchor.BN(500_000 * UNIT)
      )
      .accountsPartial({
        user: initializer.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: initializerAtaX,
        userY: initializerAtaY,
        userLp: initializerAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    const postLp = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );

    const minted = Number(postLp.value.amount) - Number(preLp.value.amount);
    expect(minted).to.equal(LP_AMOUNT.toNumber());
  });

  it("Should fail to deposit with amount 0", async () => {
    try {
      await program.methods
        .deposit(
          new anchor.BN(0),
          new anchor.BN(500_000 * UNIT),
          new anchor.BN(500_000 * UNIT)
        )
        .accountsPartial({
          user: initializer.publicKey,
          mintX,
          mintY,
          config: configPDA,
          mintLp: mintLpPDA,
          vaultX,
          vaultY,
          userX: initializerAtaX,
          userY: initializerAtaY,
          userLp: initializerAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([initializer])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      const msg = error?.error?.errorCode?.code ?? error.toString();
      expect(msg).to.include("InvalidAmount");
    }
  });

  it("Swap X for Y updates balances correctly", async () => {
    userAtaLp = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        mintLpPDA,
        user.publicKey,
        true
      )
    ).address;

    const SWAP_AMOUNT = new anchor.BN(1_000 * UNIT);

    const preUserX = await provider.connection.getTokenAccountBalance(userAtaX);
    const preUserY = await provider.connection.getTokenAccountBalance(userAtaY);
    const preVaultX = await provider.connection.getTokenAccountBalance(vaultX);
    const preVaultY = await provider.connection.getTokenAccountBalance(vaultY);

    await program.methods
      .swap(true, SWAP_AMOUNT, new anchor.BN(1))
      .accountsPartial({
        user: user.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: userAtaX,
        userY: userAtaY,
        userLp: userAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const postUserX = await provider.connection.getTokenAccountBalance(
      userAtaX
    );
    const postUserY = await provider.connection.getTokenAccountBalance(
      userAtaY
    );
    const postVaultX = await provider.connection.getTokenAccountBalance(vaultX);
    const postVaultY = await provider.connection.getTokenAccountBalance(vaultY);

    expect(
      Number(preUserX.value.amount) - Number(postUserX.value.amount)
    ).to.equal(SWAP_AMOUNT.toNumber());
    expect(Number(postUserY.value.amount)).to.be.greaterThan(
      Number(preUserY.value.amount)
    );
    expect(Number(postVaultX.value.amount)).to.be.greaterThan(
      Number(preVaultX.value.amount)
    );
    expect(Number(postVaultY.value.amount)).to.be.lessThan(
      Number(preVaultY.value.amount)
    );
  });

  it("Swap Y for X updates balances correctly", async () => {
    const SWAP_AMOUNT = new anchor.BN(1_000 * UNIT);

    const preUserX = await provider.connection.getTokenAccountBalance(userAtaX);
    const preUserY = await provider.connection.getTokenAccountBalance(userAtaY);

    await program.methods
      .swap(false, SWAP_AMOUNT, new anchor.BN(1))
      .accountsPartial({
        user: user.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: userAtaX,
        userY: userAtaY,
        userLp: userAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const postUserX = await provider.connection.getTokenAccountBalance(
      userAtaX
    );
    const postUserY = await provider.connection.getTokenAccountBalance(
      userAtaY
    );

    expect(Number(postUserX.value.amount)).to.be.greaterThan(
      Number(preUserX.value.amount)
    );
    expect(
      Number(preUserY.value.amount) - Number(postUserY.value.amount)
    ).to.equal(SWAP_AMOUNT.toNumber());
  });

  it("Swap output is reduced by fee compared to no-fee theoretical amount", async () => {
    const SWAP_AMOUNT = new anchor.BN(10_000 * UNIT);

    const preVaultX = await provider.connection.getTokenAccountBalance(vaultX);
    const preVaultY = await provider.connection.getTokenAccountBalance(vaultY);
    const preUserY = await provider.connection.getTokenAccountBalance(userAtaY);

    await program.methods
      .swap(true, SWAP_AMOUNT, new anchor.BN(1))
      .accountsPartial({
        user: user.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: userAtaX,
        userY: userAtaY,
        userLp: userAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const postUserY = await provider.connection.getTokenAccountBalance(
      userAtaY
    );

    const yReceived =
      Number(postUserY.value.amount) - Number(preUserY.value.amount);
    const vX = Number(preVaultX.value.amount);
    const vY = Number(preVaultY.value.amount);
    const dx = SWAP_AMOUNT.toNumber();
    const theoreticalOut = Math.floor((vY * dx) / (vX + dx));

    expect(yReceived).to.be.lessThan(theoreticalOut);
  });

  it("Should fail to swap with amount 0", async () => {
    try {
      await program.methods
        .swap(true, new anchor.BN(0), new anchor.BN(1))
        .accountsPartial({
          user: user.publicKey,
          mintX,
          mintY,
          config: configPDA,
          mintLp: mintLpPDA,
          vaultX,
          vaultY,
          userX: userAtaX,
          userY: userAtaY,
          userLp: userAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      const msg = error?.error?.errorCode?.code ?? error.toString();
      expect(msg).to.include("InvalidAmount");
    }
  });

  it("Withdraw burns LP tokens and returns proportional tokens", async () => {
    const lpBalance = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );
    const WITHDRAW_AMOUNT = new anchor.BN(
      Math.floor(Number(lpBalance.value.amount) / 2)
    );

    const preUserX = await provider.connection.getTokenAccountBalance(
      initializerAtaX
    );
    const preUserY = await provider.connection.getTokenAccountBalance(
      initializerAtaY
    );
    const preLpSupply = await getMint(provider.connection, mintLpPDA);

    await program.methods
      .withdraw(WITHDRAW_AMOUNT, new anchor.BN(1), new anchor.BN(1))
      .accountsPartial({
        user: initializer.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: initializerAtaX,
        userY: initializerAtaY,
        userLp: initializerAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    const postUserX = await provider.connection.getTokenAccountBalance(
      initializerAtaX
    );
    const postUserY = await provider.connection.getTokenAccountBalance(
      initializerAtaY
    );
    const postUserLp = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );
    const postLpSupply = await getMint(provider.connection, mintLpPDA);

    const lpBurned =
      Number(lpBalance.value.amount) - Number(postUserLp.value.amount);
    expect(lpBurned).to.equal(WITHDRAW_AMOUNT.toNumber());

    expect(
      Number(
        BigInt(preLpSupply.supply.toString()) -
          BigInt(postLpSupply.supply.toString())
      )
    ).to.equal(WITHDRAW_AMOUNT.toNumber());

    expect(Number(postUserX.value.amount)).to.be.greaterThan(
      Number(preUserX.value.amount)
    );
    expect(Number(postUserY.value.amount)).to.be.greaterThan(
      Number(preUserY.value.amount)
    );
  });

  it("Should fail to withdraw with amount 0", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(0), new anchor.BN(1), new anchor.BN(1))
        .accountsPartial({
          user: initializer.publicKey,
          mintX,
          mintY,
          config: configPDA,
          mintLp: mintLpPDA,
          vaultX,
          vaultY,
          userX: initializerAtaX,
          userY: initializerAtaY,
          userLp: initializerAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([initializer])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      const msg = error?.error?.errorCode?.code ?? error.toString();
      expect(msg).to.include("InvalidAmount");
    }
  });

  it("Should fail to withdraw when min token amounts cannot be satisfied", async () => {
    try {
      await program.methods
        .withdraw(
          new anchor.BN(1_000 * UNIT),
          new anchor.BN("18446744073709551615"),
          new anchor.BN("18446744073709551615")
        )
        .accountsPartial({
          user: initializer.publicKey,
          mintX,
          mintY,
          config: configPDA,
          mintLp: mintLpPDA,
          vaultX,
          vaultY,
          userX: initializerAtaX,
          userY: initializerAtaY,
          userLp: initializerAtaLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([initializer])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      const msg = error?.error?.errorCode?.code ?? error.toString();
      expect(msg).to.include("SlippageExceeded");
    }
  });

  it("Withdraw remaining LP balance empties user share", async () => {
    const lpBalance = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );
    const REMAINING = new anchor.BN(lpBalance.value.amount);

    await program.methods
      .withdraw(REMAINING, new anchor.BN(1), new anchor.BN(1))
      .accountsPartial({
        user: initializer.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp: mintLpPDA,
        vaultX,
        vaultY,
        userX: initializerAtaX,
        userY: initializerAtaY,
        userLp: initializerAtaLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    const finalLp = await provider.connection.getTokenAccountBalance(
      initializerAtaLp
    );
    expect(finalLp.value.amount).to.equal("0");
  });
});
