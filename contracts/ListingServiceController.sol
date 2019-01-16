pragma solidity 0.4.24;

import "chainlink/solidity/contracts/Chainlinked.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract ListingServiceController is Chainlinked, Ownable {

  uint256 constant private SELECTOR_LENGTH = 4;
  uint256 constant private REQUEST_ARGS_COUNT = 4;
  // solium-disable-next-line zeppelin/no-arithmetic-operations
  uint256 constant private MINIMUM_REQUEST_LENGTH = SELECTOR_LENGTH + (32 * REQUEST_ARGS_COUNT);
    
  event RequestCreated(
    address indexed from,
    uint256 indexed amount,
    address indexed oracle,
    bytes32 jobId
  );

  event RequestFulfilled(
    bytes32 indexed requestId,
    address indexed oracle,
    bytes32 indexed data
  );

  constructor(address _link) Ownable() public {
    setLinkToken(_link);
  }
  
  function encodePayload(address _oracle, string _jobId)
    external
	pure
	returns (bytes)
  {
    return abi.encodeWithSelector(this.createRequest.selector, 0, 0, _oracle, stringToBytes32(_jobId));
  }
  
  function onTokenTransfer(
    address _sender,
    uint256 _amount,
    bytes _data
  )
    public
    onlyLINK
    validRequestLength(_data)
    permittedFunctionsForLINK(_data)
  {
    assembly {
      mstore(add(_data, 36), _sender)
      mstore(add(_data, 68), _amount)
    }
	// This delegatecall calls createRequest
    require(address(this).delegatecall(_data), "Unable to create request"); // solium-disable-line security/no-low-level-calls
  }

  function createRequest(address _sender, uint256 _amount, address _oracle, bytes32 _jobId)
    external
    onlyLINK
  {
    ChainlinkLib.Run memory run = newRun(_jobId, this, this.fulfill.selector);
    chainlinkRequestFrom(_oracle, run, _amount);
    emit RequestCreated(_sender, _amount, _oracle, _jobId);
  }

  function fulfill(bytes32 _requestId, bytes32 _data)
    public
    checkChainlinkFulfillment(_requestId)
  {
    emit RequestFulfilled(_requestId, msg.sender, _data);
  }

  function cancelRequest(bytes32 _requestId)
	external
	onlyOwner
  {
    cancelChainlinkRequest(_requestId);
  }

  function withdrawLink()
    external
	onlyOwner
  {
    LinkTokenInterface link = LinkTokenInterface(chainlinkToken());
    require(link.transfer(msg.sender, link.balanceOf(address(this))), "Unable to transfer");
  }
  
  function stringToBytes32(string memory source)
    private
	pure
	returns (bytes32 result)
  {
    bytes memory tempEmptyStringTest = bytes(source);
    if (tempEmptyStringTest.length == 0) {
      return 0x0;
    }

    assembly {
      result := mload(add(source, 32))
    }
  }

  modifier onlyLINK() {
    require(msg.sender == chainlinkToken(), "Must use LINK token");
    _;
  }

  modifier permittedFunctionsForLINK(bytes _data) {
    bytes4 funcSelector;
    assembly {
      funcSelector := mload(add(_data, 32))
    }
    require(funcSelector == this.createRequest.selector, "Must use whitelisted functions");
    _;
  }
  
  modifier validRequestLength(bytes _data) {
    require(_data.length >= MINIMUM_REQUEST_LENGTH, "Invalid data payload length");
    _;
  }

}