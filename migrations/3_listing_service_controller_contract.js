var ListingServiceController = artifacts.require("ListingServiceController");
var LinkToken = artifacts.require("LinkToken");

module.exports = (deployer, network, accounts) => {
    deployer.deploy(ListingServiceController, LinkToken.address, {from: accounts[0]});
};