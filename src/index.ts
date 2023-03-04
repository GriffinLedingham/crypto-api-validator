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

  const response = (await (
    await fetch(definedApiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    })
  ).json()) as {
    data: { getNftEvents: { items: DefinedNftEvent[] } };
  };
  const definedSales = response.data.getNftEvents.items
    .filter((item: DefinedNftEvent) => item.eventType !== "Transfer")
    .map((sale: DefinedNftEvent) => ({
      source: "Defined",
      contractAddress: sale.contractAddress.toLowerCase(),
      tokenId: parseInt(sale.tokenId),
      price: sale.individualTradePrice,
      blockNumber: sale.blockNumber,
      maker: sale.maker.toLowerCase(),
      taker: sale.taker.toLowerCase(),
      transactionHash: sale.transactionHash,
      logIndex: sale.logIndex,
      timestamp: sale.timestamp,
    }))
    .sort((a, b) => a.transactionHash.localeCompare(b.transactionHash))
    .sort((a, b) => a.tokenId - b.tokenId);

  const tParams = {
    chain_id: "ethereum",
    contract_address: contractAddress,
    order: "desc",
    limit: definedSales.length,
    sold_after: variables.timestamp.from,
    sold_before: variables.timestamp.to,
  };
  const tResponse =
    // Handle transpose breaking on 0 limit
    tParams.limit === 0
      ? { results: [] }
      : ((await (
          await fetch(`${transposeApiUrl}?${querystring.stringify(tParams)}`, {
            method: "GET",
            headers: {
              "X-API-KEY": transposeApiKey,
            },
          })
        ).json()) as {
          results: TransposeNftEvent[];
        });
  const transposeSales = tResponse.results
    .map((sale) => ({
      source: "Transpose",
      contractAddress: sale.contract_address.toLowerCase(),
      tokenId: sale.token_id,
      price: sale.eth_price.toString(),
      blockNumber: sale.block_number,
      maker: sale.seller.toLowerCase(),
      taker: sale.buyer.toLowerCase(),
      transactionHash: sale.transaction_hash,
    }))
    // sort by transaction hash and token id
    .sort((a, b) => a.transactionHash.localeCompare(b.transactionHash))
    .sort((a, b) => a.tokenId - b.tokenId);

  const rResponse = (await (
    await fetch(
      `${reservoirApiUrl}?collection=${contractAddress}&sortBy=eventTimestamp&types=sale`,
      {
        method: "GET",
        headers: {
          "X-API-KEY": reservoirApiKey,
        },
      }
    )
  ).json()) as {
    activities: ReservoirNftEvent[];
  };
  const reservoirSales = rResponse.activities
    .map((sale: ReservoirNftEvent) => ({
      source: "Reservoir",
      contractAddress: sale.contract.toLowerCase(),
      tokenId: parseInt(sale.token.tokenId),
      price: sale.price.toString(),
      maker: sale.fromAddress.toLowerCase(),
      taker: sale.toAddress.toLowerCase(),
      transactionHash: sale.txHash,
      timestamp: sale.timestamp,
    }))
    .filter((sale) => sale.timestamp > variables.timestamp.from)
    .filter((sale) => sale.timestamp < variables.timestamp.to)

    .sort((a, b) => a.timestamp - b.timestamp);

  // get the most recent N sales, where N is number of Defined sales
  const trimmedReservoirSales = reservoirSales
    .slice(reservoirSales.length - definedSales.length)
    .sort((a, b) => a.transactionHash.localeCompare(b.transactionHash))
    .sort((a, b) => a.tokenId - b.tokenId);

  if (process.env.DEBUG) {
    console.log("Raw Defined Sales: ", definedSales);
    console.log("Raw Transpose Sales: ", transposeSales);
    console.log("Raw Reservoir Sales: ", trimmedReservoirSales);
  }

  if (definedSales.length === 0)
    console.log("No sales found for Defined in this time period.");
  if (transposeSales.length === 0)
    console.log("No sales found for Transpose in this time period.");
  if (trimmedReservoirSales.length === 0)
    console.log("No sales found for Reservoir in this time period.");
  validateSales(definedSales, "Defined", transposeSales, "Transpose");
  validateSales(definedSales, "Defined", trimmedReservoirSales, "Reservoir");
}

(async () => {
  validateData();
})();

function validateSales(
  source1Sales: Sale[],
  source1: string,
  source2Sales: Sale[],
  source2: string
) {
  const lastSource1BlockNumber =
    source1Sales[source1Sales.length - 1]?.blockNumber;
  const lastSource1Timestamp = source1Sales[source1Sales.length - 1]?.timestamp;

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
          (source1Sale.blockNumber !== undefined &&
            source2Sale.blockNumber !== undefined &&
            source1Sale.blockNumber !== source2Sale.blockNumber)
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
    if (
      !found &&
      ((source2Sale.source === "Reservoir" &&
        source2Sale.timestamp !== undefined &&
        lastSource1Timestamp !== undefined &&
        source2Sale.timestamp > lastSource1Timestamp) ||
        (source2Sale.source === "Transpose" &&
          source2Sale.blockNumber !== undefined &&
          lastSource1BlockNumber !== undefined &&
          source2Sale.blockNumber > lastSource1BlockNumber))
    ) {
      missingSource1Sales.push(source2Sale);
    }
  }

  console.log(`============ Compare ${source1} & ${source2} ============`);
  if (missingSource1Sales.length > 0)
    console.log(
      `${missingSource1Sales.length} items missing from ${source1}: `,
      missingSource1Sales
    );
  if (missingSource2Sales.length > 0)
    console.log(
      `${missingSource2Sales.length} items missing from ${source2}: `,
      missingSource2Sales
    );
  if (mismatchedSales.length > 0)
    console.log(
      `${source1} & ${source2} Mismatched sales items:`,
      mismatchedSales
    );
  if (
    missingSource1Sales.length === 0 &&
    missingSource2Sales.length === 0 &&
    mismatchedSales.length === 0
  ) {
    console.log("No discrepancies found!");
  }
}
