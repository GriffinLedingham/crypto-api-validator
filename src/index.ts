import fetch from "node-fetch";
import querystring from "querystring";
import * as dotenv from "dotenv";
import {
  DefinedNftEvent,
  ReservoirNftEvent,
  Sale,
  TransposeNftEvent,
} from "./types/types";

dotenv.config();

const definedApiKey = process.env.DEFINED_API_KEY || "";
const transposeApiKey = process.env.TRANSPOSE_API_KEY || "";
const reservoirApiKey = process.env.RESERVOIR_API_KEY || "";

const definedApiUrl = process.env.DEFINED_API_URL || "";
const transposeApiUrl = process.env.TRANSPOSE_API_URL || "";
const reservoirApiUrl = process.env.RESERVOIR_API_URL || "";

const args = process.argv.slice(2);
const contractAddress = args[0];

const variables = {
  timestamp: {
    // look back 2 hours for fresh data
    from: parseInt((Date.now() / 1000).toString()) - 60 * 60 * 2,
    // 5 minutes ago (to account for latency of other API's)
    to: parseInt((Date.now() / 1000).toString()) - 60 * 5,
  },
};

async function validateData() {
  const headers = {
    "content-type": "application/json",
    "x-api-key": definedApiKey,
  };
  const requestBody = {
    query: `{
      getNftEvents(networkId: 1, address: "${contractAddress}", timestamp: {from: ${variables.timestamp.from}, to: ${variables.timestamp.to}}) {
        items {
          id
          contractAddress
          networkId
          tokenId
          maker
          taker
          fillSource
          totalTradePrice
          totalPriceUsd
          totalPriceNetworkBaseToken
          individualTradePrice
          individualPriceUsd
          individualPriceNetworkBaseToken
          paymentTokenAddress
          eventType
          data {
            buyHash
            metadata
            price
            maker
            taker
            type
            sellHash
          }
          exchangeAddress
          poolAddress
          sortKey
          blockNumber
          transactionIndex
          logIndex
          transactionHash
          timestamp
          numberOfTokens
          priceError
        }
        cursor
      }
    }`,
  };
  const options = {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  };

  const response = (await (await fetch(definedApiUrl, options)).json()) as {
    data: { getNftEvents: { items: DefinedNftEvent[] } };
  };
  const definedSales = response.data.getNftEvents.items
    .filter((item: DefinedNftEvent) => item.eventType !== "Transfer")
    .map((sale: DefinedNftEvent) => ({
      source: "Defined",
      contractAddress: sale.contractAddress.toLowerCase(),
      tokenId: sale.tokenId,
      price: sale.individualTradePrice,
      blockNumber: sale.blockNumber,
      maker: sale.maker.toLowerCase(),
      taker: sale.taker.toLowerCase(),
      transactionHash: sale.transactionHash,
      logIndex: sale.logIndex,
      timestamp: sale.timestamp,
    }));

  // To check if Defined sales are missing any transpose sales, that are from a block number higher than the last blockNumber in a Defined sale
  const lastDefinedBlockNumber =
    definedSales[definedSales.length - 1].blockNumber;
  // To check if Defined sales are missing any Reservoir sales (Reservoir doesn't expose blockNumber), that are from a timestamp higher than the last timestamp in a Defined sale
  const lastDefinedTimestamp = definedSales[definedSales.length - 1].timestamp;

  definedSales
    .sort((a, b) => a.transactionHash.localeCompare(b.transactionHash))
    .sort((a, b) => a.tokenId.localeCompare(b.tokenId));

  const params = {
    chain_id: "ethereum",
    contract_address: contractAddress,
    order: "desc",
    limit: definedSales.length,
  };
  var tHeaders = {
    "X-API-KEY": transposeApiKey,
  };
  const tOptions = {
    method: "GET",
    headers: tHeaders,
  };
  const tResponse = (await (
    await fetch(`${transposeApiUrl}?${querystring.stringify(params)}`, tOptions)
  ).json()) as {
    results: TransposeNftEvent[];
  };
  const transposeSales = tResponse.results
    .map((sale) => ({
      source: "Transpose",
      contractAddress: sale.contract_address.toLowerCase(),
      tokenId: sale.token_id.toString(),
      price: sale.eth_price.toString(),
      blockNumber: sale.block_number,
      maker: sale.seller.toLowerCase(),
      taker: sale.buyer.toLowerCase(),
      transactionHash: sale.transaction_hash,
    }))
    // sort by transaction hash and token id
    .sort((a, b) => a.transactionHash.localeCompare(b.transactionHash))
    .sort((a, b) => a.tokenId.localeCompare(b.tokenId));

  let missingTransposeSales = [];
  let mismatchedSales = [];

  if (definedSales.length !== transposeSales.length) {
    console.log("###");
    console.log("Transpose & Defined sales counts do not match");
    console.log("Defined", definedSales.length);
    console.log("Transpose", transposeSales.length);
    console.log("###");
  }

  // Ensure that definedSales and transposeSales are the same for all cases of matching tokenId & transactionHash
  for (let i = 0; i < definedSales.length; i++) {
    const definedSale = definedSales[i];
    let found = false;
    for (let j = 0; j < transposeSales.length; j++) {
      const transposeSale = transposeSales[j];
      if (
        definedSale.tokenId === transposeSale.tokenId &&
        definedSale.transactionHash === transposeSale.transactionHash &&
        definedSale.maker === transposeSale.maker &&
        definedSale.taker === transposeSale.taker
      ) {
        found = true;
        if (
          definedSale.contractAddress !== transposeSale.contractAddress ||
          definedSale.price !== transposeSale.price ||
          definedSale.blockNumber !== transposeSale.blockNumber
        ) {
          mismatchedSales.push({
            definedSale,
            transposeSale,
          });
        }
      }
    }
    if (!found) {
      missingTransposeSales.push(definedSale);
    }
  }

  let missingDefinedSales = [];

  for (let i = 0; i < transposeSales.length; i++) {
    const transposeSale = transposeSales[i];
    let found = false;
    for (let j = 0; j < definedSales.length; j++) {
      const definedSale = definedSales[j];
      if (
        definedSale.tokenId === transposeSale.tokenId &&
        definedSale.transactionHash === transposeSale.transactionHash &&
        definedSale.maker === transposeSale.maker &&
        definedSale.taker === transposeSale.taker
      ) {
        found = true;
      }
    }
    if (!found && transposeSale.blockNumber > lastDefinedBlockNumber) {
      missingDefinedSales.push(transposeSale);
    }
  }

  console.log("Items missing from Transpose: ", missingTransposeSales);
  console.log("Items missing from Defined: ", missingDefinedSales);
  console.log("Mismatched sales items:", mismatchedSales);
  console.log("Sales missing from Tranpose: ", missingTransposeSales.length);
  console.log("Sales missing from Defined: ", missingDefinedSales.length);
  console.log("Mismatched sales: ", mismatchedSales.length);

  const rHeaders = {
    "X-API-KEY": reservoirApiKey,
  };
  const rOptions = {
    method: "GET",
    headers: rHeaders,
  };
  const rResponse = (await (
    await fetch(
      `${reservoirApiUrl}?collection=${contractAddress}&limit=${definedSales.length}&sortBy=eventTimestamp&types=sale`,
      rOptions
    )
  ).json()) as {
    activities: ReservoirNftEvent[];
  };

  const reservoirSales = rResponse.activities.map(
    (sale: ReservoirNftEvent) => ({
      source: "Reservoir",
      contractAddress: sale.contract.toLowerCase(),
      tokenId: sale.token.tokenId.toString(),
      price: sale.price.toString(),
      maker: sale.fromAddress.toLowerCase(),
      taker: sale.toAddress.toLowerCase(),
      transactionHash: sale.txHash,
      timestamp: sale.timestamp,
    })
  );
  // sort by transaction hash and token id
  reservoirSales.sort((a, b) =>
    a.transactionHash.localeCompare(b.transactionHash)
  );
  reservoirSales.sort((a, b) => a.tokenId.localeCompare(b.tokenId));

  // compare to defined
  let missingReservoirSales = [];
  let mismatchedReservoirSales = [];

  if (definedSales.length !== reservoirSales.length) {
    console.log("###");
    console.log("Reservoir & Defined sales counts do not match");
    console.log("Defined", definedSales.length);
    console.log("Reservoir", reservoirSales.length);
    console.log("###");
  }

  // Ensure that definedSales and reservoirSales are the same for all cases of matching tokenId & transactionHash
  for (let i = 0; i < definedSales.length; i++) {
    const definedSale = definedSales[i];
    let found = false;
    for (let j = 0; j < reservoirSales.length; j++) {
      const reservoirSale = reservoirSales[j];
      if (
        definedSale.tokenId === reservoirSale.tokenId &&
        definedSale.transactionHash === reservoirSale.transactionHash &&
        definedSale.maker === reservoirSale.maker &&
        definedSale.taker === reservoirSale.taker
      ) {
        found = true;
        if (
          definedSale.contractAddress !== reservoirSale.contractAddress ||
          definedSale.price !== reservoirSale.price
        ) {
          mismatchedReservoirSales.push({
            definedSale,
            reservoirSale,
          });
        }
      }
    }
    if (!found) {
      missingReservoirSales.push(definedSale);
    }
  }

  let missingDefinedReservoirSales = [];

  // check if Defined sales are missing any reservoir sales, that are from a block number higher than the last blockNumber in a Defined sale
  for (let i = 0; i < reservoirSales.length; i++) {
    const reservoirSale = reservoirSales[i];
    let found = false;
    for (let j = 0; j < definedSales.length; j++) {
      const definedSale = definedSales[j];
      if (
        definedSale.tokenId === reservoirSale.tokenId &&
        definedSale.transactionHash === reservoirSale.transactionHash &&
        definedSale.maker === reservoirSale.maker &&
        definedSale.taker === reservoirSale.taker
      ) {
        found = true;
      }
    }
    if (!found && reservoirSale.timestamp > lastDefinedTimestamp) {
      missingDefinedReservoirSales.push(reservoirSale);
    }
  }

  console.log("Items missing from Reservoir: ", missingReservoirSales);
  console.log("Items missing from Defined: ", missingDefinedReservoirSales);
  console.log("Mismatched sales items:", mismatchedReservoirSales);
  console.log("Sales missing from Reservoir: ", missingReservoirSales.length);
  console.log(
    "Sales missing from Defined: ",
    missingDefinedReservoirSales.length
  );
  console.log("Mismatched sales: ", mismatchedReservoirSales.length);
}

(async () => {
  validateData();
})();

function validateSales(source1Sales: Sale[], source2Sales: Sale[]) {
  let missingSource1Sales = [];
  let missingSource2Sales = [];
  let mismatchedSales = [];

  // Ensure that source1Sales and source2Sales are the same for all cases of matching tokenId & transactionHash
  for (let i = 0; i < source1Sales.length; i++) {
    const source1Sale = source1Sales[i];
    let found = false;
    for (let j = 0; j < source2Sales.length; j++) {
      const source2Sale = source2Sales[j];
      if (
        source1Sale.tokenId === source2Sale.tokenId &&
        source1Sale.transactionHash === source2Sale.transactionHash &&
        source1Sale.maker === source2Sale.maker &&
        source1Sale.taker === source2Sale.taker
      ) {
        found = true;
        if (
          source1Sale.contractAddress !== source2Sale.contractAddress ||
          source1Sale.price !== source2Sale.price ||
          source1Sale.blockNumber !== source2Sale.blockNumber
        ) {
          mismatchedSales.push({
            source1Sale,
            source2Sale,
          });
        }
      }
    }
    if (!found) {
      missingSource2Sales.push(source1Sale);
    }
  }

  for (let i = 0; i < source2Sales.length; i++) {
    const source2Sale = source2Sales[i];
    let found = false;
    for (let j = 0; j < source1Sales.length; j++) {
      const source1Sale = source1Sales[j];
      if (
        source1Sale.tokenId === source2Sale.tokenId &&
        source1Sale.transactionHash === source2Sale.transactionHash &&
        source1Sale.maker === source2Sale.maker &&
        source1Sale.taker === source2Sale.taker
      ) {
        found = true;
      }
    }
    if (!found) {
      missingSource1Sales.push(source2Sale);
    }
  }

  console.log("Items missing from Source 1: ", missingSource1Sales);
  console.log("Items missing from Source 2: ", missingSource2Sales);
  console.log("Mismatched sales items:", mismatchedSales);
  console.log("Sales missing from Source 1: ", missingSource1Sales.length);
  console.log("Sales missing from Source 2: ", missingSource2Sales.length);
  console.log("Mismatched sales: ", mismatchedSales.length);
}
