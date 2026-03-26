import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";


async function airdrop(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  sol = 10
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL
  );
  const latest = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction({ signature: sig, ...latest });
}

/**
 * Derives the escrow PDA.
 * Seeds: ["escrow", maker, seed_le_bytes]
 * Mirrors make.rs: seed.to_le_bytes()
 */
function deriveEscrowPda(
  programId: PublicKey,
  maker: PublicKey,
  seed: BN
): [PublicKey, number] {
  const seedBuf = Buffer.alloc(8);
  seedBuf.writeBigUInt64LE(BigInt(seed.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), maker.toBuffer(), seedBuf],
    programId
  );
}



describe("escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Escrow as Program<Escrow>;
  const connection = provider.connection;

  // Participants
  const maker = Keypair.generate();
  const taker = Keypair.generate();
  const mintAuthority = Keypair.generate();

  // Token mints 
  let mintX: PublicKey; // maker offers this
  let mintY: PublicKey; // maker wants this in return

  // Token accounts 
  let makerAtaX: PublicKey; // maker's mint_x balance  (source of deposit)
  let makerAtaY: PublicKey; // maker's mint_y balance  (destination of receive)
  let takerAtaX: PublicKey; // taker's mint_x balance  (destination from vault)
  let takerAtaY: PublicKey; // taker's mint_y balance  (source of payment)

  // Escrow state 
  const SEED           = new BN(42);
  const DEPOSIT_AMOUNT = new BN(1_000_000); // maker deposits 1 token (6 dp)
  const RECEIVE_AMOUNT = new BN(2_000_000); // maker wants 2 tokens in return
  const DECIMALS       = 6;

  let escrowKey:  PublicKey;
  let escrowBump: number;
  let vault:      PublicKey; // ATA owned by escrow PDA, holds mint_x

  before("fund wallets, create mints, create ATAs, seed balances", async () => {
    await Promise.all([
      airdrop(provider, maker.publicKey),
      airdrop(provider, taker.publicKey),
      airdrop(provider, mintAuthority.publicKey),
    ]);

    mintX = await createMint(
      connection, maker, mintAuthority.publicKey, null, DECIMALS,
      undefined, undefined, TOKEN_PROGRAM_ID
    );
    mintY = await createMint(
      connection, taker, mintAuthority.publicKey, null, DECIMALS,
      undefined, undefined, TOKEN_PROGRAM_ID
    );

    makerAtaX = await createAssociatedTokenAccount(
      connection, maker, mintX, maker.publicKey
    );
    makerAtaY = await createAssociatedTokenAccount(
      connection, maker, mintY, maker.publicKey  // mint_y — correct
    );
    takerAtaX = await createAssociatedTokenAccount(
      connection, taker, mintX, taker.publicKey
    );
    takerAtaY = await createAssociatedTokenAccount(
      connection, taker, mintY, taker.publicKey
    );

    // Give maker enough mint_x to deposit
    await mintTo(
      connection, maker, mintX, makerAtaX,
      mintAuthority, DEPOSIT_AMOUNT.toNumber()
    );

    // Give taker enough mint_y to pay
    await mintTo(
      connection, taker, mintY, takerAtaY,
      mintAuthority, RECEIVE_AMOUNT.toNumber()
    );

    [escrowKey, escrowBump] = deriveEscrowPda(
      program.programId, maker.publicKey, SEED
    );
    vault = getAssociatedTokenAddressSync(
      mintX, escrowKey,
      true,             // allowOwnerOffCurve — escrow is a PDA
      TOKEN_PROGRAM_ID
    );
  });


  describe("make", () => {

    /**
     * Covers BUG-1 and BUG-4.
     *
     * BUG-1 — maker_ata_y is constrained to mint_x instead of mint_y in make.rs.
     *   Expected failure: transaction rejected immediately with ConstraintAssociated.
     *   This test never even reaches the vault balance assertion.
     *   Fix: associated_token::mint = mint_y  on the maker_ata_y account.
     *
     * BUG-4 — lib.rs never calls ctx.accounts.deposit() after make().
     *   Expected failure: vault balance assertion — vault holds 0 instead of 1_000_000.
     *   Surfaces only after BUG-1 is fixed.
     *   Fix: add ctx.accounts.deposit(deposit_amount)? in the make handler.
     */
    it("stores correct escrow state and moves deposit_amount into the vault", async () => {
      await program.methods
        .make(SEED, DEPOSIT_AMOUNT, RECEIVE_AMOUNT)
        .accountsStrict({
          maker:                  maker.publicKey,
          mintX,
          mintY,
          makerAtaX,
          makerAtaY,
          escrow:                 escrowKey,
          vault,
          systemProgram:          SystemProgram.programId,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();

      // escrow account fields 
      const escrow = await program.account.escrow.fetch(escrowKey);
      assert.equal(escrow.seed.toString(),         SEED.toString(),            "seed");
      assert.equal(escrow.maker.toBase58(),         maker.publicKey.toBase58(), "maker");
      assert.equal(escrow.mintX.toBase58(),         mintX.toBase58(),           "mint_x");
      assert.equal(escrow.mintY.toBase58(),         mintY.toBase58(),           "mint_y");
      assert.equal(escrow.depositAmount.toString(), DEPOSIT_AMOUNT.toString(),  "deposit_amount");
      assert.equal(escrow.receiveAmount.toString(), RECEIVE_AMOUNT.toString(),  "receive_amount");
      assert.equal(escrow.bump,                     escrowBump,                 "bump");

      // vault holds the deposited tokens (RED while BUG-4 present) 
      const vaultAccount = await getAccount(connection, vault);
      assert.equal(
        vaultAccount.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "vault must hold deposit_amount after make"
      );

      // maker's mint_x balance reduced by deposit_amount
      const makerX = await getAccount(connection, makerAtaX);
      assert.equal(
        makerX.amount.toString(),
        "0",
        "maker_ata_x must be empty after depositing full balance"
      );
    });

    it("rejects a duplicate make with the same seed", async () => {
      try {
        await program.methods
          .make(SEED, DEPOSIT_AMOUNT, RECEIVE_AMOUNT)
          .accountsStrict({
            maker:                  maker.publicKey,
            mintX,
            mintY,
            makerAtaX,
            makerAtaY,
            escrow:                 escrowKey,
            vault,
            systemProgram:          SystemProgram.programId,
            tokenProgram:           TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([maker])
          .rpc();
        assert.fail("expected error — escrow already exists");
      } catch (e: any) {
        assert.ok(e, "correctly rejected duplicate make with same seed");
      }
    });

    it("different seed produces a distinct escrow PDA", async () => {
      const altSeed = new BN(99);
      const [altEscrow] = deriveEscrowPda(
        program.programId, maker.publicKey, altSeed
      );
      const altVault = getAssociatedTokenAddressSync(
        mintX, altEscrow, true, TOKEN_PROGRAM_ID
      );

      await mintTo(
        connection, maker, mintX, makerAtaX,
        mintAuthority, DEPOSIT_AMOUNT.toNumber()
      );

      await program.methods
        .make(altSeed, DEPOSIT_AMOUNT, RECEIVE_AMOUNT)
        .accountsStrict({
          maker:                  maker.publicKey,
          mintX,
          mintY,
          makerAtaX,
          makerAtaY,
          escrow:                 altEscrow,
          vault:                  altVault,
          systemProgram:          SystemProgram.programId,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();

      assert.notEqual(
        altEscrow.toBase58(),
        escrowKey.toBase58(),
        "different seeds must produce different PDAs"
      );
    });

  });

  
  describe("take", () => {
    let makerAtaYBefore: bigint;
    let takerAtaXBefore: bigint;

    before("snapshot balances before take", async () => {
      const mY = await getAccount(connection, makerAtaY);
      const tX = await getAccount(connection, takerAtaX);
      makerAtaYBefore = mY.amount;
      takerAtaXBefore = tX.amount;
    });

    /**
     * Covers BUG-2 and BUG-3.
     *
     * BUG-2 — take.rs deposit() passes maker_ata_y as the mint field in TransferChecked.
     *   Expected failure: SPL token program returns InvalidAccountData because it
     *   tries to deserialise a TokenAccount as a Mint.
     *   Fix: mint: self.mint_y.to_account_info()
     *
     * BUG-3 — take.rs withdraw() and close() re-derive the escrow PDA with
     *   to_be_bytes() but make.rs created it with to_le_bytes().
     *   Expected failure: invoke_signed fails — derived address doesn't match,
     *   runtime returns privilege escalation / unauthorized signer error.
     *   Surfaces only after BUG-2 is fixed.
     *   Fix: change both to_be_bytes() calls to to_le_bytes() in take.rs.
     */
    it("swaps tokens — mint_y from taker to maker, mint_x from vault to taker", async () => {
      await program.methods
        .take()
        .accountsStrict({
          taker:                  taker.publicKey,
          mintX,
          mintY,
          takerAtaX,
          takerAtaY,
          makerAtaX,
          makerAtaY,
          escrow:                 escrowKey,
          vault,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .signers([taker])
        .rpc();

      // maker received exactly receive_amount of mint_y 
      const makerY = await getAccount(connection, makerAtaY);
      assert.equal(
        (makerY.amount - makerAtaYBefore).toString(),
        RECEIVE_AMOUNT.toString(),
        "maker must receive exactly receive_amount of mint_y"
      );

      // taker received exactly deposit_amount of mint_x 
      const takerX = await getAccount(connection, takerAtaX);
      assert.equal(
        (takerX.amount - takerAtaXBefore).toString(),
        DEPOSIT_AMOUNT.toString(),
        "taker must receive exactly deposit_amount of mint_x"
      );

      // taker fully spent their mint_y 
      const takerY = await getAccount(connection, takerAtaY);
      assert.equal(
        takerY.amount.toString(),
        "0",
        "taker_ata_y must be fully spent after take"
      );
    });

    it("vault token account is closed after take", async () => {
      const vaultInfo = await connection.getAccountInfo(vault);
      assert.isNull(vaultInfo, "vault must be closed — rent returned to taker");
    });

    it("escrow PDA is closed after take", async () => {
      const escrowInfo = await connection.getAccountInfo(escrowKey);
      assert.isNull(escrowInfo, "escrow PDA must be closed after take");
    });

  });

});