"use strict";

let abi = require("ethereumjs-abi");

let ListingServiceController = artifacts.require("ListingServiceController.sol");
let Oracle = artifacts.require("Oracle.sol");
let LinkToken = artifacts.require("LinkToken.sol");

contract("ListingServiceController", (accounts) => {
    let tryCatch = require("./support/helpers.js").tryCatch;
    let errTypes = require("./support/helpers.js").errTypes;
    let owner = accounts[1];
    let stranger = accounts[2];
    let nodeOperator = accounts[3];
    let node = accounts[4];
    let linkContract, oracleContract, lscContract;

    const JOB_ID = "80c7f937f9354ab38a3caed972ebc0cd";

    const abiEncode = (types, values) => {
        return abi.rawEncode(types, values).toString("hex");
    };

    const functionSelector = signature => "0x" + web3.utils.keccak256(signature).slice(2).slice(0, 8);

    const createRequestBytes = (oracle, jobId) => {
        const types = ["address", "uint256", "address", "bytes32"];
        const values = [0, 0, oracle, jobId];
        const encoded = abiEncode(types, values);
        const funcSelector = functionSelector("createRequest(address,uint256,address,bytes32)");
        return funcSelector + encoded;
    };

    const checkPublicABI = (contract, expectedPublic) => {
        let actualPublic = [];
        for (const method of contract.abi) {
            if (method.type === "function") actualPublic.push(method.name);
        }

        for (const method of actualPublic) {
            let index = expectedPublic.indexOf(method);
            assert.isAtLeast(index, 0, (`#${method} is NOT expected to be public`));
        }

        for (const method of expectedPublic) {
            let index = actualPublic.indexOf(method);
            assert.isAtLeast(index, 0, (`#${method} is expected to be public`));
        }
    };

    beforeEach(async () => {
        linkContract = await LinkToken.new();
        oracleContract = await Oracle.new(linkContract.address, {from: nodeOperator});
        await oracleContract.setFulfillmentPermission(node, true, {from: nodeOperator});
        lscContract = await ListingServiceController.new(
            linkContract.address, 
            {from: owner}
        );
        await linkContract.transfer(nodeOperator, web3.utils.toWei("1", "ether"));
    });

    it("has a limited public interface", () => {
        checkPublicABI(lscContract, [
            "encodePayload",
            "onTokenTransfer",
            "createRequest",
            "fulfill",
            "cancelRequest",
            "withdrawLink",
            "owner",
            "renounceOwnership",
            "transferOwnership"
        ]);
    });

    it("does not trigger functions upon receipt of LINK via normal transfer", async () => {
        let tx = await linkContract.transfer(lscContract.address, web3.utils.toWei("1", "ether"));
        assert.equal(1, tx.receipt.logs.length);
        assert.equal(linkContract.address, tx.receipt.logs[0].address);
    });

    describe("encodePayload", () => {
        it("returns encoded data", async () => {
            const expected = createRequestBytes(oracleContract.address, JOB_ID);
            const result = await lscContract.encodePayload.call(oracleContract.address, JOB_ID);
            assert.equal(expected, result);
        });
    });

    describe("onTokenTransfer", () => {
        let callData;

        beforeEach(async () => {
            callData = await lscContract.encodePayload.call(oracleContract.address, JOB_ID);
        });

        context("when called from any address but the LINK token", () => {
            it("reverts", async () => {
                await tryCatch(lscContract.onTokenTransfer(nodeOperator, 0, callData, {from: nodeOperator}), errTypes.revert);
            });
        });

        context("when called from the LINK token", () => {
            it("triggers the intended method", async () => { 
                let tx = await linkContract.transferAndCall(lscContract.address, 0, callData, {from: nodeOperator});
                assert.equal(4, tx.receipt.logs.length);
            });

            context("with no data", () => {
                it("reverts", async () => {
                    await tryCatch(lscContract.onTokenTransfer(nodeOperator, 0, "0x00"), errTypes.revert);
                });
            });
        });
    });

    describe("createRequest", () => {
        let callData;

        beforeEach(async () => {
            callData = await lscContract.encodePayload.call(oracleContract.address, JOB_ID);
        });

        context("when called from any address but the LINK token", () => {
            it("reverts", async () => {
                await tryCatch(lscContract.createRequest(nodeOperator, 0, oracleContract.address, `0x${JOB_ID}`, {from: nodeOperator}), errTypes.revert);
                await tryCatch(lscContract.createRequest(nodeOperator, 0, oracleContract.address, `0x${JOB_ID}`, {from: owner}), errTypes.revert);
                await tryCatch(lscContract.createRequest(nodeOperator, 0, oracleContract.address, `0x${JOB_ID}`, {from: stranger}), errTypes.revert);
                await tryCatch(lscContract.createRequest(nodeOperator, 0, oracleContract.address, `0x${JOB_ID}`, {from: node}), errTypes.revert);
            });
        });

        context("when called from the LINK token", () => {
            it("triggers the intended method", async () => { 
                let tx = await linkContract.transferAndCall(lscContract.address, 0, callData, {from: nodeOperator});
                assert.equal(tx.receipt.rawLogs[6].topics[0], web3.utils.keccak256("RequestCreated(address,uint256,address,bytes32)"));
            });

        });
    });

    describe("fulfill", () => {
        let callData, requestId;
        let responseData = "0x48656c6c6f20776f726c64000000000000000000000000000000000000000000";

        beforeEach(async () => {
            callData = await lscContract.encodePayload.call(oracleContract.address, JOB_ID);
            let tx = await linkContract.transferAndCall(lscContract.address, 0, callData, {from: nodeOperator});
            requestId = tx.receipt.rawLogs[2].data;
        });

        context("when called from any address but the oracle contract", () => {
            it("reverts", async () => {
                await tryCatch(lscContract.fulfill(requestId, responseData, {from: nodeOperator}), errTypes.revert);
                await tryCatch(lscContract.fulfill(requestId, responseData, {from: owner}), errTypes.revert);
                await tryCatch(lscContract.fulfill(requestId, responseData, {from: stranger}), errTypes.revert);
                await tryCatch(lscContract.fulfill(requestId, responseData, {from: node}), errTypes.revert);
            });
        });

        context("when called from the oracle contract", () => {
            it("accepts the response", async () => {
                let tx = await oracleContract.fulfillData(requestId, responseData, {from: node});
                assert.equal(tx.receipt.rawLogs[1].topics[0], web3.utils.keccak256("RequestFulfilled(bytes32,address,bytes32)"));
                assert.equal(tx.receipt.rawLogs[1].topics[3], responseData);
            });
        });
    });

    describe("cancelRequest", () => {
        let callData, requestId;

        beforeEach(async () => {
            callData = await lscContract.encodePayload.call(oracleContract.address, JOB_ID);
            let tx = await linkContract.transferAndCall(lscContract.address, 0, callData, {from: nodeOperator});
            requestId = tx.receipt.rawLogs[2].data;
        });

        context("before 5 minutes", () => {
            it("reverts", async () => {
                await tryCatch(lscContract.cancelRequest(requestId, {from: owner}), errTypes.revert);
            });
        });

        context("after 5 minutes", () => {
            beforeEach(async () => {
                await web3.currentProvider.send({
                    jsonrpc: "2.0",
                    method: "evm_increaseTime",
                    params: [300],
                    id: 0
                }, (error, result) => { // eslint-disable-line no-unused-vars
                    if (error) {
                        console.error(`Error during evm_increaseTime! ${error}`); // eslint-disable-line no-console
                        throw error;
                    }
                });
            });

            context("when called from any address but the owner", () => {
                it("reverts", async () => {
                    await tryCatch(lscContract.cancelRequest(requestId, {from: stranger}), errTypes.revert);
                });
            });

            context("when called from the owner", () => {
                it("allows the owner cancel the request", async () => {
                    let tx = await lscContract.cancelRequest(requestId, {from: owner});
                    assert.equal(tx.receipt.rawLogs[2].address, oracleContract.address);
                    assert.equal(tx.receipt.rawLogs[2].topics[0], web3.utils.keccak256("CancelRequest(bytes32)"));
                });
            });
        });
    });

    describe("withdrawLink", () => {
        beforeEach(async () => {
            await linkContract.transfer(lscContract.address, web3.utils.toWei("1", "ether"));
        });

        context("when called from any address but the owner", () => {
            it("reverts", async () => {
                await tryCatch(lscContract.withdrawLink({from: stranger}), errTypes.revert);
            });
        });

        context("when called from the owner", () => {
            it("allows the owner to withdraw the contract's LINK balance", async () => {
                const oldBalance = await linkContract.balanceOf(lscContract.address);
                await lscContract.withdrawLink({from: owner});
                const newBalance = await linkContract.balanceOf(lscContract.address);
                const ownerBalance = await linkContract.balanceOf(owner);
                assert.equal(newBalance.toString(), 0);
                assert.equal(ownerBalance.toString(), oldBalance.toString());
            });
        });
    });
});