export type DefinedNftEvent = {
  id: string;
  contractAddress: string;
  networkId: number;
  tokenId: string;
  maker: string;
  taker: string;
  fillSource: string;
  totalTradePrice: string;
  totalPriceUsd: string;
  totalPriceNetworkBaseToken: string;
  individualTradePrice: string;
  individualPriceUsd: string;
  individualPriceNetworkBaseToken: string;
  paymentTokenAddress: string;
  eventType: string;
  exchangeAddress: string;
  poolAddress: string;
  sortKey: string;
  blockNumber: number;
  transactionIndex: number;
  logIndex: number;
  transactionHash: string;
  timestamp: number;
  numberOfTokens: number;
  priceError: string;
};

export type TransposeNftEvent = {
  contract_address: string;
  token_id: number;
  eth_price: number;
  block_number: number;
  seller: string;
  buyer: string;
  transaction_hash: string;
};

export type ReservoirNftEvent = {
  type: string;
  fromAddress: string;
  toAddress: string;
  price: number;
  amount: number;
  timestamp: number;
  createdAt: string;
  contract: string;
  txHash: string;
  token: {
    tokenId: string;
    tokenName: string;
    tokenImage: string;
  };
  collection: {
    collectionId: string;
    collectionImage: string;
    collectionName: string;
  };
  order: {
    id: string;
    side: string;
    source: {
      domain: string;
      name: string;
      icon: string;
    };
  };
};

export type Sale = {
  // source : "Reservoir",
  // contractAddress: sale.contract.toLowerCase(),
  // tokenId: sale.token.tokenId.toString(),
  // price: sale.price.toString(),
  // maker: sale.fromAddress.toLowerCase(),
  // taker: sale.toAddress.toLowerCase(),
  // transactionHash: sale.txHash,
  // timestamp: sale.timestamp,
  source: string;
  contractAddress: string;
  tokenId: string;
  price: string;
  maker: string;
  taker: string;
  transactionHash: string;
  blockNumber?: number;
  timestamp?: number;
};
