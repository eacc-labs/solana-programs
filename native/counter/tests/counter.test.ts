import * as borsh from "borsh";
import * as path from "path";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { describe, test, beforeAll, expect } from "bun:test";
import {
    PublicKey,
    TransactionInstruction,
    Transaction,
    Keypair,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";

enum Instruction {
    Increment = 0,
    Decrement = 1,
}

type CounterData = {
    count: bigint;
};

class Counter {
    count: bigint;

    constructor(count: bigint) {
        this.count = count;
    }

    static schema = {
        struct: {
            count: "u64",
        },
    };

    static deserialize(data: Buffer): Counter {
        const decoded = borsh.deserialize(Counter.schema, data) as CounterData;
        return new Counter(decoded.count);
    }

    serialize(): Buffer {
        return Buffer.from(
            borsh.serialize(Counter.schema, { count: this.count }),
        );
    }
}

describe("Counter", () => {
    const PROGRAM_ID = new PublicKey(
        "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
    );

    let svm: LiteSVM;
    let counter: Keypair;
    let user: Keypair;

    beforeAll(() => {
        svm = new LiteSVM();
        counter = Keypair.generate();
        user = Keypair.generate();

        svm.airdrop(user.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        const program = path.join(__dirname, "fixtures", "counter.so");
        svm.addProgramFromFile(PROGRAM_ID, program);

        const counterAccount = new Counter(0n);
        svm.setAccount(counter.publicKey, {
            lamports: 1_000_000,
            data: counterAccount.serialize(),
            owner: PROGRAM_ID,
            executable: false,
        });
    });

    test("Increment", () => {
        const incrementIx = new TransactionInstruction({
            keys: [
                {
                    pubkey: counter.publicKey,
                    isWritable: true,
                    isSigner: false,
                },
            ],
            programId: PROGRAM_ID,
            data: Buffer.from([Instruction.Increment]),
        });

        const incrementTx = new Transaction();
        incrementTx.recentBlockhash = svm.latestBlockhash();
        incrementTx.feePayer = user.publicKey;
        incrementTx.add(incrementIx);
        incrementTx.sign(user);

        svm.sendTransaction(incrementTx);

        const counterAccountInfo = svm.getAccount(counter.publicKey);
        if (counterAccountInfo) {
            const counterData = Counter.deserialize(
                Buffer.from(counterAccountInfo?.data),
            );
            expect(counterData.count).toBe(1n);
        } else {
            return console.error("Couldn't fetch the counter account");
        }
    });

    test("Decrement", () => {
        const decrementIx = new TransactionInstruction({
            keys: [
                {
                    pubkey: counter.publicKey,
                    isWritable: true,
                    isSigner: false,
                },
            ],
            programId: PROGRAM_ID,
            data: Buffer.from([Instruction.Decrement]),
        });

        const decrementTx = new Transaction();
        decrementTx.recentBlockhash = svm.latestBlockhash();
        decrementTx.feePayer = user.publicKey;
        decrementTx.add(decrementIx);
        decrementTx.sign(user);

        svm.sendTransaction(decrementTx);

        const counterAccountInfo = svm.getAccount(counter.publicKey);
        if (counterAccountInfo) {
            const counterData = Counter.deserialize(
                Buffer.from(counterAccountInfo?.data),
            );
            expect(counterData.count).toBe(0n);
        } else {
            return console.error("Couldn't fetch the counter account");
        }
    });
});
